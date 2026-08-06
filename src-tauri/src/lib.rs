mod channels;
mod claude_code;
mod net;
mod pty;
mod secrets;

use channels::ChannelState;
use claude_code::ClaudeCodeState;
use pty::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PtyState::default())
        .manage(ClaudeCodeState::default())
        .manage(ChannelState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            claude_code::claude_code_detect,
            claude_code::claude_code_install,
            claude_code::claude_code_run,
            claude_code::claude_code_cancel,
            net::http_fetch,
            secrets::secret_set,
            secrets::secret_get,
            channels::telegram_start,
            channels::telegram_send,
            channels::discord_start,
            channels::discord_send,
            channels::discord_send_bot,
            channels::channel_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Forge");
}
