//! Discord bot: poll a channel, post replies and files, plus plain webhooks.

use super::files::{build_multipart, read_file_capped};
use super::*;

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
            .get(&format!(
                "{}/channels/{discord_channel_id}/messages?limit=1",
                discord_api()
            ))
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
            let url = format!(
                "{}/channels/{discord_channel_id}/messages?after={last_id}&limit=50",
                discord_api()
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
                if let Some(id) = msg
                    .get("id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<u64>().ok())
                {
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

#[cfg(test)]
mod tests {
    use super::*;
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
