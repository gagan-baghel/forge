mod bridge;
mod channels;
mod claude_code;
mod desktop;
mod e2e;
mod net;
mod pty;
mod shell;

use bridge::BridgeState;
use channels::ChannelState;
use claude_code::ClaudeCodeState;
use desktop::DesktopState;
use pty::PtyState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Self-update from GitHub Releases: signed builds only (see tauri.conf.json).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyState::default())
        .manage(ClaudeCodeState::default())
        .manage(ChannelState::default())
        .manage(DesktopState::default())
        .manage(e2e::E2eState::default())
        .setup(|app| {
            app.manage(BridgeState::start(app.handle().clone()));
            e2e::start(app.handle().clone());
            Ok(())
        })
        // Closing the window hides it instead of quitting (the macOS norm), so
        // live bots keep answering the phone. ⌘Q still quits for real.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            shell::shell_exec,
            shell::shell_cancel,
            claude_code::claude_code_detect,
            claude_code::claude_code_install,
            claude_code::claude_code_run,
            claude_code::claude_code_cancel,
            bridge::bridge_respond,
            net::http_fetch,
            channels::telegram_start,
            channels::telegram_send,
            channels::telegram_edit,
            channels::telegram_send_file,
            channels::telegram_send_photo,
            channels::discord_start,
            channels::discord_send,
            channels::discord_send_bot,
            channels::discord_send_file,
            channels::channel_typing,
            channels::channel_fetch_file,
            channels::channel_stop,
            desktop::screen_capture,
            desktop::input_click,
            desktop::input_scroll,
            desktop::input_type,
            desktop::input_key,
            desktop::keep_awake,
            e2e::e2e_report,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Forge")
        .run(|app, event| {
            // Dock icon click after the window was hidden: bring it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            let _ = (app, event);
        });
}
