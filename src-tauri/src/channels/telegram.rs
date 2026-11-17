//! Telegram bot: long-poll updates, send, edit, upload.

use super::*;
use super::files::{build_multipart, read_file_capped};

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

#[cfg(test)]
mod tests {
    use super::*;
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
}
