//! A single interactive PTY shell, exposed to the frontend over Tauri commands.
//! Output bytes are streamed to the webview as `pty://data` events.

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{Emitter, State};

/// Holds the live PTY master + writer. `None` until `pty_spawn` is called.
#[derive(Default)]
pub struct PtyState {
    inner: Mutex<Option<PtyHandle>>,
}

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".into()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: State<PtyState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    if let Some(home) = dirs_home() {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Pump reader -> frontend.
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit("pty://data", chunk);
                }
            }
        }
    });

    *state.inner.lock().unwrap() = Some(PtyHandle {
        master: pair.master,
        writer,
    });
    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    if let Some(handle) = state.inner.lock().unwrap().as_mut() {
        handle
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        handle.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(handle) = state.inner.lock().unwrap().as_ref() {
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<PtyState>) -> Result<(), String> {
    *state.inner.lock().unwrap() = None;
    Ok(())
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}
