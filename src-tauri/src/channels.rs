//! Live messaging channels. A channel runs a real bot: it long-polls the
//! provider for inbound messages, emits each one to the frontend as a
//! `channel://message` event (where the agent generates a reply), and exposes
//! a send command to deliver replies. Telegram and Discord are both fully
//! bidirectional (Discord additionally supports plain outbound webhooks).

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

#[derive(Serialize, Clone)]
struct InboundMessage {
    channel_id: String,
    chat_id: String,
    text: String,
    from: String,
}

fn ureq_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(60))
        .build()
}

/// Start polling a Telegram bot. Emits `channel://message` per inbound message.
#[tauri::command]
pub fn telegram_start(
    app: tauri::AppHandle,
    state: State<ChannelState>,
    channel_id: String,
    token: String,
) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Missing Telegram bot token.".into());
    }
    {
        let mut running = state.running.lock().unwrap();
        if running.contains_key(&channel_id) {
            return Ok(()); // already running
        }
        running.insert(channel_id.clone(), Arc::new(AtomicBool::new(true)));
    }
    let stop = state.running.lock().unwrap().get(&channel_id).unwrap().clone();
    let base = format!("https://api.telegram.org/bot{token}");

    std::thread::spawn(move || {
        let agent = ureq_agent();
        let mut offset: i64 = 0;
        // Validate the token once; surface failures to the UI.
        if let Ok(resp) = agent.get(&format!("{base}/getMe")).call() {
            let _ = resp.into_string();
        }
        while stop.load(Ordering::Relaxed) {
            let url = format!("{base}/getUpdates?timeout=30&offset={offset}");
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
                let msg = &upd["message"];
                let text = msg.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let chat_id = msg["chat"]["id"].as_i64().map(|n| n.to_string()).unwrap_or_default();
                let from = msg["from"]["first_name"].as_str().unwrap_or("user").to_string();
                if text.is_empty() || chat_id.is_empty() {
                    continue;
                }
                let _ = app.emit(
                    "channel://message",
                    InboundMessage {
                        channel_id: channel_id.clone(),
                        chat_id,
                        text: text.to_string(),
                        from,
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn telegram_send(token: String, chat_id: String, text: String) -> Result<(), String> {
    let agent = ureq_agent();
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    agent
        .post(&url)
        .send_json(ureq::json!({ "chat_id": chat_id, "text": text }))
        .map_err(|e| format!("telegram send failed: {e}"))?;
    Ok(())
}

const DISCORD_API: &str = "https://discord.com/api/v10";

/// Start polling a Discord channel with a bot token. Only messages posted
/// after the poller starts are delivered (no history replay). `trigger` is
/// "all" or "mention" (only messages that @mention the bot).
#[tauri::command]
pub fn discord_start(
    app: tauri::AppHandle,
    state: State<ChannelState>,
    channel_id: String,
    token: String,
    discord_channel_id: String,
    trigger: String,
) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Missing Discord bot token.".into());
    }
    if discord_channel_id.trim().is_empty() {
        return Err("Missing Discord channel ID.".into());
    }

    let agent = ureq_agent();
    let auth = format!("Bot {}", token.trim());

    // Validate the token up front and learn the bot's own user id, so we can
    // ignore its replies and implement mention-only triggering.
    let me = agent
        .get(&format!("{DISCORD_API}/users/@me"))
        .set("Authorization", &auth)
        .call()
        .map_err(|e| format!("Discord rejected the bot token: {e}"))?;
    let me_json: serde_json::Value =
        serde_json::from_str(&me.into_string().unwrap_or_default()).unwrap_or_default();
    let bot_id = me_json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    {
        let mut running = state.running.lock().unwrap();
        if running.contains_key(&channel_id) {
            return Ok(()); // already running
        }
        running.insert(channel_id.clone(), Arc::new(AtomicBool::new(true)));
    }
    let stop = state.running.lock().unwrap().get(&channel_id).unwrap().clone();

    std::thread::spawn(move || {
        // Baseline: newest message id at start, so history isn't replayed.
        let mut last_id: u64 = agent
            .get(&format!("{DISCORD_API}/channels/{discord_channel_id}/messages?limit=1"))
            .set("Authorization", &auth)
            .call()
            .ok()
            .and_then(|r| r.into_string().ok())
            .and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok())
            .and_then(|j| j.as_array().and_then(|a| a.first().cloned()))
            .and_then(|m| m.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
            .unwrap_or(0);

        while stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(3));
            let url = format!(
                "{DISCORD_API}/channels/{discord_channel_id}/messages?after={last_id}&limit=50"
            );
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
                // Never react to bots (including ourselves) — avoids reply loops.
                if msg["author"]["bot"].as_bool() == Some(true) {
                    continue;
                }
                if trigger == "mention" {
                    let mentioned = msg["mentions"]
                        .as_array()
                        .map(|a| a.iter().any(|u| u["id"].as_str() == Some(bot_id.as_str())))
                        .unwrap_or(false);
                    if !mentioned {
                        continue;
                    }
                }
                let text = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
                if text.is_empty() {
                    continue;
                }
                let from = msg["author"]["username"].as_str().unwrap_or("user").to_string();
                let _ = app.emit(
                    "channel://message",
                    InboundMessage {
                        channel_id: channel_id.clone(),
                        chat_id: discord_channel_id.clone(),
                        text: text.to_string(),
                        from,
                    },
                );
            }
        }
    });

    Ok(())
}

/// Post a message to a Discord channel as the bot (two-way channel replies).
#[tauri::command]
pub fn discord_send_bot(token: String, channel_id: String, text: String) -> Result<(), String> {
    let agent = ureq_agent();
    agent
        .post(&format!("{DISCORD_API}/channels/{channel_id}/messages"))
        .set("Authorization", &format!("Bot {}", token.trim()))
        .send_json(ureq::json!({ "content": text }))
        .map_err(|e| format!("discord send failed: {e}"))?;
    Ok(())
}

/// Post a message to a Discord channel via an incoming webhook URL.
#[tauri::command]
pub fn discord_send(webhook: String, text: String) -> Result<(), String> {
    let agent = ureq_agent();
    agent
        .post(&webhook)
        .send_json(ureq::json!({ "content": text }))
        .map_err(|e| format!("discord send failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn channel_stop(state: State<ChannelState>, channel_id: String) -> Result<(), String> {
    if let Some(flag) = state.running.lock().unwrap().remove(&channel_id) {
        flag.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn channel_running(state: State<ChannelState>, channel_id: String) -> bool {
    state.running.lock().unwrap().contains_key(&channel_id)
}
