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

pub mod discord;
pub mod files;
pub mod telegram;

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

#[derive(Serialize)]
pub struct BotInfo {
    pub id: String,
    pub username: String,
}

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
}
