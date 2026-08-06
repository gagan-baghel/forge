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
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Auto-update is desktop-only and needs a signing pubkey in tauri.conf.json.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
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
            claude_code::claude_code_login,
            claude_code::claude_code_login_input,
            claude_code::claude_code_login_cancel,
            claude_code::claude_code_run,
            claude_code::claude_code_cancel,
            net::http_fetch,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            channels::telegram_start,
            channels::telegram_send,
            channels::discord_start,
            channels::discord_send,
            channels::discord_send_bot,
            channels::channel_stop,
            channels::channel_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Forge");
}
