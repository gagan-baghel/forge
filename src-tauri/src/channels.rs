//! Live messaging channels. A channel runs a real bot: it long-polls the
//! provider for inbound messages, emits each one to the frontend as a
//! `channel://message` event (where the sender is authorised and the agent
//! generates a reply), and exposes send commands to deliver replies, approval
//! prompts and files. Telegram and Discord are both fully bidirectional
//! (Discord additionally supports plain outbound webhooks).
//!
//! Nothing here decides who may talk to an agent — the frontend checks every
//! inbound sender against the channel's paired owners before anything runs.
//! That is also why inbound attachments are only *referenced* here and fetched
//! later by `channel_fetch_file`: a stranger's upload never touches the disk.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Default)]
pub struct ChannelState {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// An attachment on an inbound message. `file_ref` is a Telegram `file_id` or
/// a Discord CDN URL; `channel_fetch_file` turns it into a local path.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileRef {
    file_ref: String,
    name: String,
}

#[derive(Serialize, Clone)]
struct InboundMessage {
    channel_id: String,
    chat_id: String,
    /// Stable provider user id of the sender — what pairing authorises.
    sender_id: String,
    from: String,
    text: String,
    /// "message" for a normal message, "callback" for a Telegram button press.
    kind: String,
    files: Vec<FileRef>,
}

fn ureq_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).build()
}

/// Telegram puts the bot token in every URL, and ureq's error text quotes the
/// URL — so a raw error would print the token into the UI and the run log.
fn redact(err: impl std::fmt::Display, token: &str) -> String {
    let s = err.to_string();
    if token.is_empty() {
        s
    } else {
        s.replace(token, "<token>")
    }
}

/* ------------------------------ Text chunking ----------------------------- */

/// Telegram caps a message at 4096 UTF-16 units and Discord at 2000 chars; a
/// long agent reply over either limit used to fail outright. Split on line
/// breaks where possible, hard-cut otherwise, and never inside a char.
pub fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let text = if text.trim().is_empty() { "…" } else { text };
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for line in text.split_inclusive('\n') {
        let line_len = line.chars().count();
        if current_len + line_len <= max_chars {
            current.push_str(line);
            current_len += line_len;
            continue;
        }
        if !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        // A single line longer than the limit: hard-cut it.
        let mut buf = String::new();
        let mut n = 0;
        for ch in line.chars() {
            if n == max_chars {
                chunks.push(std::mem::take(&mut buf));
                n = 0;
            }
            buf.push(ch);
            n += 1;
        }
        current = buf;
        current_len = n;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

const TELEGRAM_CHUNK: usize = 3900;
const DISCORD_CHUNK: usize = 1900;

/* -------------------------------- Files ---------------------------------- */

/// Cap on a file the `send_file` tool will upload. Keeps one IPC round-trip
/// and one HTTP request bounded; well under Discord's (8-25MB) and Telegram's
/// (50MB) own limits either way.
const MAX_SEND_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Cap on an inbound attachment we download from a paired owner.
const MAX_FETCH_FILE_BYTES: u64 = 50 * 1024 * 1024;

fn read_file_capped(path: &str) -> Result<(Vec<u8>, String), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("can't read {path}: {e}"))?;
    if meta.len() > MAX_SEND_FILE_BYTES {
        return Err(format!(
            "{path} is {} MB, over the 20 MB send limit.",
            meta.len() / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("can't read {path}: {e}"))?;
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    Ok((bytes, name))
}

/// Build a `multipart/form-data` body by hand — neither provider's upload
/// endpoint is JSON, and ureq has no multipart helper of its own.
fn build_multipart(fields: &[(&str, &str)], file_field: &str, filename: &str, file_bytes: &[u8]) -> (Vec<u8>, String) {
    let boundary = format!(
        "----forge-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n\
             Content-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (body, format!("multipart/form-data; boundary={boundary}"))
}

/// A provider-supplied file name reduced to a safe leaf: no directories, no
/// dot-files, nothing that could climb out of the inbox folder.
fn safe_file_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = leaf
        .chars()
        .filter(|c| !c.is_control() && *c != ':')
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// Where inbound attachments land: `~/Downloads/Forge`.
fn inbox_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("no home directory")?;
    let dir = std::path::PathBuf::from(home).join("Downloads").join("Forge");
    std::fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// First free `name`, `name (1)`, … in `dir` — never overwrite a file.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Download an inbound attachment into `~/Downloads/Forge` and return its path.
/// Called by the frontend only after the sender has been authorised.
#[tauri::command]
pub async fn channel_fetch_file(kind: String, token: String, file_ref: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        let url = if kind == "telegram" {
            let resp = agent
                .get(&format!("{}/bot{token}/getFile", telegram_api()))
                .query("file_id", &file_ref)
                .call()
                .map_err(|e| redact(e, &token))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            let path = json["result"]["file_path"].as_str().ok_or("Telegram didn't return the file.")?;
            format!("{}/file/bot{token}/{path}", telegram_api())
        } else {
            // Debug builds may point at a fake Discord (see api_root) — its
            // attachments are served from the same fake.
            let test_cdn = cfg!(debug_assertions) && std::env::var("FORGE_DISCORD_API").is_ok_and(|a| file_ref.starts_with(&a));
            if !test_cdn && !file_ref.starts_with("https://cdn.discordapp.com/") && !file_ref.starts_with("https://media.discordapp.net/") {
                return Err("Refusing to fetch a Discord attachment from an unexpected host.".into());
            }
            file_ref.clone()
        };

        let resp = agent.get(&url).call().map_err(|e| redact(e, &token))?;
        let mut bytes = Vec::new();
        use std::io::Read;
        resp.into_reader()
            .take(MAX_FETCH_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FETCH_FILE_BYTES {
            return Err("Attachment is over the 50 MB limit.".into());
        }
        let path = unique_path(&inbox_dir()?, &safe_file_name(&name));
        std::fs::write(&path, bytes).map_err(|e| format!("can't save {}: {e}", path.display()))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ------------------------------- Telegram -------------------------------- */

fn telegram_files(msg: &serde_json::Value) -> Vec<FileRef> {
    let mut files = Vec::new();
    if let Some(doc) = msg.get("document") {
        if let Some(id) = doc["file_id"].as_str() {
            files.push(FileRef {
                file_ref: id.into(),
                name: doc["file_name"].as_str().unwrap_or("document").into(),
            });
        }
    }
    // Photos arrive as several sizes; the last is the largest.
    if let Some(sizes) = msg.get("photo").and_then(|p| p.as_array()) {
        if let Some(id) = sizes.last().and_then(|p| p["file_id"].as_str()) {
            let uid = sizes.last().and_then(|p| p["file_unique_id"].as_str()).unwrap_or("photo");
            files.push(FileRef { file_ref: id.into(), name: format!("photo_{uid}.jpg") });
        }
    }
    for key in ["video", "audio", "voice"] {
        if let Some(v) = msg.get(key) {
            if let Some(id) = v["file_id"].as_str() {
                let fallback = format!("{key}_{}", v["file_unique_id"].as_str().unwrap_or("file"));
                files.push(FileRef {
                    file_ref: id.into(),
                    name: v["file_name"].as_str().map(String::from).unwrap_or(fallback),
                });
            }
        }
    }
    files
}

/// Turn one Telegram update into an inbound event, or None to ignore it.
///
/// Messages dated before the poller started (`since`, unix seconds) are
/// dropped. Telegram re-delivers anything a previous run hadn't confirmed yet,
/// and replaying it after a restart re-ran old requests — a command could run
/// twice. Discord skips history the same way. Messages sent while Forge was
/// off are not acted on later, out of the blue.
fn telegram_inbound(channel_id: &str, upd: &serde_json::Value, since: i64) -> Option<InboundMessage> {
    if let Some(cb) = upd.get("callback_query") {
        return Some(InboundMessage {
            channel_id: channel_id.into(),
            chat_id: cb["message"]["chat"]["id"].as_i64()?.to_string(),
            sender_id: cb["from"]["id"].as_i64()?.to_string(),
            from: cb["from"]["first_name"].as_str().unwrap_or("user").into(),
            text: cb["data"].as_str()?.into(),
            kind: "callback".into(),
            files: vec![],
        });
    }
    let msg = upd.get("message")?;
    if msg["date"].as_i64().is_some_and(|d| d < since) {
        return None;
    }
    let text = msg["text"].as_str().or(msg["caption"].as_str()).unwrap_or("").to_string();
    let files = telegram_files(msg);
    if text.is_empty() && files.is_empty() {
        return None;
    }
    Some(InboundMessage {
        channel_id: channel_id.into(),
        chat_id: msg["chat"]["id"].as_i64()?.to_string(),
        sender_id: msg["from"]["id"].as_i64()?.to_string(),
        from: msg["from"]["first_name"].as_str().unwrap_or("user").into(),
        text,
        kind: "message".into(),
        files,
    })
}

#[derive(Serialize)]
pub struct BotInfo {
    pub id: String,
    pub username: String,
}

/// Start polling a Telegram bot. Emits `channel://message` per inbound message
/// or button press. Validates the token first so a typo fails loudly instead
/// of leaving a poller that silently never receives anything.
#[tauri::command]
pub async fn telegram_start(
    app: tauri::AppHandle,
    state: State<'_, ChannelState>,
    channel_id: String,
    token: String,
) -> Result<BotInfo, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Missing Telegram bot token.".into());
    }
    let base = format!("{}/bot{token}", telegram_api());

    let me = {
        let (base, token) = (base.clone(), token.clone());
        tauri::async_runtime::spawn_blocking(move || -> Result<BotInfo, String> {
            let resp = ureq_agent()
                .get(&format!("{base}/getMe"))
                .call()
                .map_err(|e| format!("Telegram rejected the bot token: {}", redact(e, &token)))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            // The "/" menu on the phone. Best effort: a bot works without it.
            let _ = ureq_agent().post(&format!("{base}/setMyCommands")).send_json(ureq::json!({
                "commands": [
                    { "command": "status", "description": "What the agent is doing" },
                    { "command": "stop", "description": "Stop the current task" },
                    { "command": "new", "description": "Start a fresh conversation" },
                    { "command": "screenshot", "description": "See your screen" },
                    { "command": "lock", "description": "End an Allow-15-min window" },
                    { "command": "help", "description": "What I can do" },
                ]
            }));
            Ok(BotInfo {
                id: json["result"]["id"].as_i64().map(|n| n.to_string()).unwrap_or_default(),
                username: json["result"]["username"].as_str().unwrap_or("").into(),
            })
        })
        .await
        .map_err(|e| e.to_string())??
    };

    let stop = {
        let mut running = state.running.lock().unwrap();
        if running.contains_key(&channel_id) {
            return Ok(me); // already running
        }
        let flag = Arc::new(AtomicBool::new(true));
        running.insert(channel_id.clone(), flag.clone());
        flag
    };

    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    std::thread::spawn(move || {
        let agent = ureq_agent();
        let mut offset: i64 = 0;
        while stop.load(Ordering::Relaxed) {
            let url = format!(
                "{base}/getUpdates?timeout=30&offset={offset}&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D"
            );
            let body = match agent.get(&url).call() {
                Ok(r) => r.into_string().unwrap_or_default(),
                Err(_) => {
                    std::thread::sleep(Duration::from_secs(3));
                    continue;
                }
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) else {
                continue;
            };
            let Some(updates) = json.get("result").and_then(|v| v.as_array()) else {
                continue;
            };
            for upd in updates {
                if let Some(id) = upd.get("update_id").and_then(|v| v.as_i64()) {
                    offset = id + 1;
                }
                // A button press shows a spinner on the phone until answered.
                if let Some(cb_id) = upd["callback_query"]["id"].as_str() {
                    let _ = agent
                        .post(&format!("{base}/answerCallbackQuery"))
                        .send_json(ureq::json!({ "callback_query_id": cb_id }));
                }
                if !stop.load(Ordering::Relaxed) {
                    break;
                }
                if let Some(msg) = telegram_inbound(&channel_id, upd, since) {
                    let _ = app.emit("channel://message", msg);
                }
            }
        }
    });

    Ok(me)
}

/// One inline-keyboard button: `[label, callback_data]`.
type Button = (String, String);

/// Send a (possibly long) message. Buttons, if any, ride on the last chunk.
/// Returns the id of the last message sent, so it can be edited later.
#[tauri::command]
pub async fn telegram_send(
    token: String,
    chat_id: String,
    text: String,
    buttons: Option<Vec<Button>>,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        let url = format!("{}/bot{token}/sendMessage", telegram_api());
        let chunks = chunk_text(&text, TELEGRAM_CHUNK);
        let last = chunks.len() - 1;
        let mut message_id = 0;
        for (i, chunk) in chunks.into_iter().enumerate() {
            let mut body = ureq::json!({ "chat_id": chat_id, "text": chunk });
            if i == last {
                if let Some(btns) = buttons.as_ref().filter(|b| !b.is_empty()) {
                    let row: Vec<_> = btns
                        .iter()
                        .map(|(label, data)| ureq::json!({ "text": label, "callback_data": data }))
                        .collect();
                    body["reply_markup"] = ureq::json!({ "inline_keyboard": [row] });
                }
            }
            let resp = agent
                .post(&url)
                .send_json(body)
                .map_err(|e| format!("telegram send failed: {}", redact(e, &token)))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            message_id = json["result"]["message_id"].as_i64().unwrap_or(0);
        }
        Ok(message_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Replace a sent message's text and drop its buttons (an answered approval).
#[tauri::command]
pub async fn telegram_edit(token: String, chat_id: String, message_id: i64, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ureq_agent()
            .post(&format!("{}/bot{token}/editMessageText", telegram_api()))
            .send_json(ureq::json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "text": chunk_text(&text, TELEGRAM_CHUNK).remove(0),
                "reply_markup": { "inline_keyboard": [] },
            }))
            .map_err(|e| format!("telegram edit failed: {}", redact(e, &token)))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Upload a local file to a Telegram chat as a document. Same role as
/// `discord_send_file`, for the Telegram side of the `send_file` agent tool.
#[tauri::command]
pub async fn telegram_send_file(token: String, chat_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, filename) = read_file_capped(&path)?;
        let (body, content_type) = build_multipart(&[("chat_id", &chat_id)], "document", &filename, &bytes);
        ureq_agent()
            .post(&format!("{}/bot{token}/sendDocument", telegram_api()))
            .set("Content-Type", &content_type)
            .send_bytes(&body)
            .map_err(|e| format!("telegram file send failed: {}", redact(e, &token)))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Upload an image as a photo (shown inline on the phone, unlike a document).
#[tauri::command]
pub async fn telegram_send_photo(token: String, chat_id: String, path: String, caption: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, filename) = read_file_capped(&path)?;
        let (body, content_type) =
            build_multipart(&[("chat_id", &chat_id), ("caption", &caption)], "photo", &filename, &bytes);
        ureq_agent()
            .post(&format!("{}/bot{token}/sendPhoto", telegram_api()))
            .set("Content-Type", &content_type)
            .send_bytes(&body)
            .map_err(|e| format!("telegram photo send failed: {}", redact(e, &token)))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/* -------------------------------- Discord -------------------------------- */

/// Provider API roots. Overridable (debug builds only) so an end-to-end test
/// can stand a local fake in for the real service; release builds always talk
/// to the real one.
fn api_root(var: &str, default: &str) -> String {
    if cfg!(debug_assertions) {
        if let Ok(v) = std::env::var(var) {
            return v.trim_end_matches('/').to_string();
        }
    }
    default.to_string()
}

fn telegram_api() -> String {
    api_root("FORGE_TELEGRAM_API", "https://api.telegram.org")
}

fn discord_api() -> String {
    api_root("FORGE_DISCORD_API", "https://discord.com/api/v10")
}

/// Start polling a Discord channel with a bot token. Only messages posted
/// after the poller starts are delivered (no history replay). `trigger` is
/// "all" or "mention" (only messages that @mention the bot).
#[tauri::command]
pub async fn discord_start(
    app: tauri::AppHandle,
    state: State<'_, ChannelState>,
    channel_id: String,
    token: String,
    discord_channel_id: String,
    trigger: String,
) -> Result<BotInfo, String> {
    if token.trim().is_empty() {
        return Err("Missing Discord bot token.".into());
    }
    if discord_channel_id.trim().is_empty() {
        return Err("Missing Discord channel ID.".into());
    }
    let auth = format!("Bot {}", token.trim());

    // Validate the token up front and learn the bot's own user id, so we can
    // ignore its replies and implement mention-only triggering.
    let me = {
        let auth = auth.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<BotInfo, String> {
            let resp = ureq_agent()
                .get(&format!("{}/users/@me", discord_api()))
                .set("Authorization", &auth)
                .call()
                .map_err(|e| format!("Discord rejected the bot token: {e}"))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            Ok(BotInfo {
                id: json["id"].as_str().unwrap_or("").into(),
                username: json["username"].as_str().unwrap_or("").into(),
            })
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let bot_id = me.id.clone();

    let stop = {
        let mut running = state.running.lock().unwrap();
        if running.contains_key(&channel_id) {
            return Ok(me); // already running
        }
        let flag = Arc::new(AtomicBool::new(true));
        running.insert(channel_id.clone(), flag.clone());
        flag
    };

    std::thread::spawn(move || {
        let agent = ureq_agent();
        // Baseline: newest message id at start, so history isn't replayed.
        let mut last_id: u64 = agent
            .get(&format!("{}/channels/{discord_channel_id}/messages?limit=1", discord_api()))
            .set("Authorization", &auth)
            .call()
            .ok()
            .and_then(|r| r.into_string().ok())
            .and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok())
            .and_then(|j| j.as_array().and_then(|a| a.first().cloned()))
            .and_then(|m| m.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
            .unwrap_or(0);

        // ponytail: REST polling every 3s, move to the Gateway websocket if
        // latency or rate limits ever matter.
        while stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(3));
            let url = format!("{}/channels/{discord_channel_id}/messages?after={last_id}&limit=50", discord_api());
            let Ok(resp) = agent.get(&url).set("Authorization", &auth).call() else {
                continue;
            };
            let body = resp.into_string().unwrap_or_default();
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) else {
                continue;
            };
            let Some(messages) = json.as_array() else { continue };

            // Discord returns newest first; process oldest first.
            for msg in messages.iter().rev() {
                if let Some(id) = msg.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()) {
                    if id > last_id {
                        last_id = id;
                    }
                }
                if let Some(inbound) = discord_inbound(&channel_id, &discord_channel_id, &bot_id, &trigger, msg) {
                    let _ = app.emit("channel://message", inbound);
                }
            }
        }
    });

    Ok(me)
}

fn discord_inbound(
    channel_id: &str,
    discord_channel_id: &str,
    bot_id: &str,
    trigger: &str,
    msg: &serde_json::Value,
) -> Option<InboundMessage> {
    // Never react to bots (including ourselves) — avoids reply loops.
    if msg["author"]["bot"].as_bool() == Some(true) {
        return None;
    }
    if trigger == "mention" {
        let mentioned = msg["mentions"]
            .as_array()
            .map(|a| a.iter().any(|u| u["id"].as_str() == Some(bot_id)))
            .unwrap_or(false);
        if !mentioned {
            return None;
        }
    }
    // Strip the bot's own mention so the agent sees just the request.
    let text = msg["content"]
        .as_str()
        .unwrap_or("")
        .replace(&format!("<@{bot_id}>"), "")
        .trim()
        .to_string();
    let files: Vec<FileRef> = msg["attachments"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|att| {
                    Some(FileRef {
                        file_ref: att["url"].as_str()?.into(),
                        name: att["filename"].as_str().unwrap_or("attachment").into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if text.is_empty() && files.is_empty() {
        return None;
    }
    Some(InboundMessage {
        channel_id: channel_id.into(),
        chat_id: discord_channel_id.into(),
        sender_id: msg["author"]["id"].as_str()?.into(),
        from: msg["author"]["username"].as_str().unwrap_or("user").into(),
        text,
        kind: "message".into(),
        files,
    })
}

/// Post a message to a Discord channel as the bot (two-way channel replies).
/// Long replies are split across messages. Returns the last message's id.
#[tauri::command]
pub async fn discord_send_bot(token: String, channel_id: String, text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        let mut last = String::new();
        for chunk in chunk_text(&text, DISCORD_CHUNK) {
            let resp = agent
                .post(&format!("{}/channels/{channel_id}/messages", discord_api()))
                .set("Authorization", &format!("Bot {}", token.trim()))
                .send_json(ureq::json!({ "content": chunk }))
                .map_err(|e| format!("discord send failed: {e}"))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            last = json["id"].as_str().unwrap_or("").to_string();
        }
        Ok(last)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Post a message to a Discord channel via an incoming webhook URL.
#[tauri::command]
pub async fn discord_send(webhook: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        for chunk in chunk_text(&text, DISCORD_CHUNK) {
            agent
                .post(&webhook)
                .send_json(ureq::json!({ "content": chunk }))
                .map_err(|e| format!("discord send failed: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Upload a local file to a Discord channel as an attachment (bot token).
/// Used by the `send_file` agent tool when a conversation arrived over Discord.
#[tauri::command]
pub async fn discord_send_file(token: String, channel_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, filename) = read_file_capped(&path)?;
        let (body, content_type) = build_multipart(&[], "files[0]", &filename, &bytes);
        ureq_agent()
            .post(&format!("{}/channels/{channel_id}/messages", discord_api()))
            .set("Authorization", &format!("Bot {}", token.trim()))
            .set("Content-Type", &content_type)
            .send_bytes(&body)
            .map_err(|e| format!("discord file send failed: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Show "typing…" on the phone while the agent works. Best effort: both
/// providers expire the indicator after a few seconds, so callers repeat it.
#[tauri::command]
pub async fn channel_typing(kind: String, token: String, chat_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        let _ = if kind == "discord" {
            agent
                .post(&format!("{}/channels/{chat_id}/typing", discord_api()))
                .set("Authorization", &format!("Bot {}", token.trim()))
                .send_string("")
        } else {
            agent
                .post(&format!("{}/bot{token}/sendChatAction", telegram_api()))
                .send_json(ureq::json!({ "chat_id": chat_id, "action": "typing" }))
        };
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn channel_stop(state: State<ChannelState>, channel_id: String) -> Result<(), String> {
    if let Some(flag) = state.running.lock().unwrap().remove(&channel_id) {
        flag.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_body_carries_fields_and_file_bytes_intact() {
        let (body, content_type) = build_multipart(&[("chat_id", "42")], "document", "notes.txt", b"hi there");
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"chat_id\""));
        assert!(text.contains("42"));
        assert!(text.contains("filename=\"notes.txt\""));
        assert!(text.contains("hi there"));
    }

    #[test]
    fn read_file_capped_rejects_a_file_over_the_size_limit() {
        let path = std::env::temp_dir().join("forge_send_file_cap_test.bin");
        std::fs::write(&path, vec![0u8; (MAX_SEND_FILE_BYTES + 1) as usize]).unwrap();
        let err = read_file_capped(path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("20 MB"), "got {err:?}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_file_capped_reads_a_small_file() {
        let path = std::env::temp_dir().join("forge_send_file_small_test.txt");
        std::fs::write(&path, b"hello").unwrap();
        let (bytes, name) = read_file_capped(path.to_str().unwrap()).unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(name, "forge_send_file_small_test.txt");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn chunking_keeps_short_text_whole_and_splits_long_text_under_the_limit() {
        assert_eq!(chunk_text("hello", 10), vec!["hello"]);
        assert_eq!(chunk_text("   ", 10), vec!["…"]);

        let long = "line one\n".repeat(50);
        let chunks = chunk_text(&long, 40);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.chars().count() <= 40));
        assert_eq!(chunks.concat(), long, "no text may be lost or reordered");
    }

    #[test]
    fn chunking_hard_cuts_one_giant_line_on_char_boundaries() {
        let s = "é".repeat(95);
        let chunks = chunk_text(&s, 40);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.concat(), s);
    }

    #[test]
    fn redact_hides_the_bot_token() {
        let err = "https://api.telegram.org/bot123:SECRET/getMe: status 401";
        assert!(!redact(err, "123:SECRET").contains("SECRET"));
    }

    #[test]
    fn inbound_file_names_cannot_escape_the_inbox() {
        assert_eq!(safe_file_name("../../.ssh/authorized_keys"), "authorized_keys");
        assert_eq!(safe_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name(""), "file");
        assert_eq!(safe_file_name("report.pdf"), "report.pdf");
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join("forge_unique_path_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.txt"), dir.join("a (1).txt"));
        assert_eq!(unique_path(&dir, "b.txt"), dir.join("b.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn telegram_messages_carry_the_sender_id_and_attachments() {
        let upd = serde_json::json!({
            "update_id": 1,
            "message": {
                "chat": { "id": 99 }, "from": { "id": 7, "first_name": "Gagan" },
                "caption": "save this",
                "document": { "file_id": "F1", "file_name": "notes.pdf" }
            }
        });
        let m = telegram_inbound("c", &upd, 0).unwrap();
        assert_eq!((m.chat_id.as_str(), m.sender_id.as_str(), m.text.as_str()), ("99", "7", "save this"));
        assert_eq!(m.kind, "message");
        assert_eq!(m.files, vec![FileRef { file_ref: "F1".into(), name: "notes.pdf".into() }]);
    }

    #[test]
    fn telegram_button_presses_arrive_as_callbacks() {
        let upd = serde_json::json!({
            "update_id": 2,
            "callback_query": {
                "id": "cb", "data": "fa:ok:abc", "from": { "id": 7, "first_name": "G" },
                "message": { "message_id": 5, "chat": { "id": 99 } }
            }
        });
        let m = telegram_inbound("c", &upd, 0).unwrap();
        assert_eq!((m.kind.as_str(), m.text.as_str(), m.sender_id.as_str()), ("callback", "fa:ok:abc", "7"));
    }

    #[test]
    fn messages_from_before_the_poller_started_are_not_replayed() {
        let upd = |date: i64| serde_json::json!({
            "update_id": 3,
            "message": { "date": date, "chat": { "id": 1 }, "from": { "id": 7, "first_name": "G" }, "text": "rm -rf ~/work" }
        });
        assert!(telegram_inbound("c", &upd(999), 1000).is_none(), "an old message must not run again");
        assert!(telegram_inbound("c", &upd(1000), 1000).is_some());
        assert!(telegram_inbound("c", &upd(1500), 1000).is_some());
    }

    #[test]
    fn discord_ignores_bots_and_strips_the_bot_mention() {
        let bot = serde_json::json!({ "author": { "id": "1", "bot": true }, "content": "hi" });
        assert!(discord_inbound("c", "ch", "B", "all", &bot).is_none());

        let human = serde_json::json!({
            "author": { "id": "42", "username": "g" },
            "content": "<@B> open my notes",
            "mentions": [{ "id": "B" }],
            "attachments": []
        });
        let m = discord_inbound("c", "ch", "B", "mention", &human).unwrap();
        assert_eq!((m.text.as_str(), m.sender_id.as_str()), ("open my notes", "42"));

        let unmentioned = serde_json::json!({ "author": { "id": "42" }, "content": "hi", "mentions": [] });
        assert!(discord_inbound("c", "ch", "B", "mention", &unmentioned).is_none());
    }
}
