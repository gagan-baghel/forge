//! Claude Code runtime.
//!
//! Instead of metered BYOK API calls, an agent can run on the user's local
//! Claude Code subscription by shelling out to the `claude` CLI in
//! non-interactive print mode (`-p --output-format stream-json`). We stream the
//! CLI's JSON event lines back to the webview as `cc://event` payloads and
//! capture the session id so follow-up turns can `--resume` the same context.
//!
//! The bridge is fully in-built: no enrollment, no cloud, no separate download
//! — just the `claude` binary already on the machine.
//!
//!  - env.rs    — locating the CLI and its login-shell environment
//!  - run.rs    — spawning one turn, its watchdog and cleanup
//!  - stream.rs — folding the CLI's stream-json lines into events

mod env;
pub mod run;
mod stream;

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, State};

pub use env::apply_shell_env;
use env::find_claude;

#[derive(Default)]
pub struct ClaudeCodeState {
    children: Mutex<HashMap<String, Child>>,
}

#[derive(Serialize, Clone)]
pub struct ClaudeCodeInfo {
    pub available: bool,
    pub version: String,
    pub path: String,
}

#[tauri::command]
pub fn claude_code_detect() -> ClaudeCodeInfo {
    let Some(bin) = find_claude() else {
        return ClaudeCodeInfo {
            available: false,
            version: String::new(),
            path: String::new(),
        };
    };
    let mut version_cmd = Command::new(&bin);
    apply_shell_env(&mut version_cmd);
    let version = version_cmd
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    ClaudeCodeInfo {
        available: !version.is_empty(),
        version,
        path: bin.to_string_lossy().to_string(),
    }
}

/// Progress events for the in-app CLI installer (`cc://install`).
#[derive(Serialize, Clone)]
#[serde(tag = "kind")]
enum InstallEvent {
    #[serde(rename = "line")]
    Line { text: String },
    #[serde(rename = "done")]
    Done {
        info: ClaudeCodeInfo,
        error: Option<String>,
    },
}

/// Install the Claude Code CLI from inside the app — the last mile of the
/// in-built bridge, so the user never leaves Forge. Tries the official native
/// installer first (no Node required), then falls back to npm. Progress lines
/// stream to the webview as `cc://install` events; the final event carries a
/// fresh detect result.
#[tauri::command]
pub fn claude_code_install(app: tauri::AppHandle) -> Result<(), String> {
    std::thread::spawn(move || {
        let emit_line = |text: &str| {
            let _ = app.emit("cc://install", InstallEvent::Line { text: text.to_string() });
        };

        // Each candidate is (label, program, args). Stop at the first success.
        #[cfg(target_os = "windows")]
        let candidates: Vec<(&str, &str, Vec<&str>)> = vec![
            (
                "official installer",
                "powershell",
                vec!["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"],
            ),
            ("npm", "npm.cmd", vec!["install", "-g", "@anthropic-ai/claude-code"]),
        ];
        #[cfg(not(target_os = "windows"))]
        let candidates: Vec<(&str, &str, Vec<&str>)> = vec![
            (
                "official installer",
                "bash",
                vec!["-lc", "curl -fsSL https://claude.ai/install.sh | bash"],
            ),
            ("npm", "bash", vec!["-lc", "npm install -g @anthropic-ai/claude-code"]),
        ];

        let mut last_err: Option<String> = None;
        for (label, prog, args) in candidates {
            emit_line(&format!("Installing Claude Code via {label}…"));
            let spawned = Command::new(prog)
                .args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();
            let mut child = match spawned {
                Ok(c) => c,
                Err(e) => {
                    last_err = Some(format!("{label}: {e}"));
                    continue;
                }
            };

            // Stream stdout + stderr line-by-line so the UI can show progress.
            let mut threads = Vec::new();
            for pipe in [
                child
                    .stdout
                    .take()
                    .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                child
                    .stderr
                    .take()
                    .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ]
            .into_iter()
            .flatten()
            {
                let app2 = app.clone();
                threads.push(std::thread::spawn(move || {
                    for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            let _ = app2.emit(
                                "cc://install",
                                InstallEvent::Line {
                                    text: trimmed.to_string(),
                                },
                            );
                        }
                    }
                }));
            }
            for t in threads {
                let _ = t.join();
            }

            match child.wait() {
                Ok(status) if status.success() => {
                    let info = claude_code_detect();
                    if info.available {
                        emit_line(&format!("Installed {} at {}", info.version, info.path));
                        let _ = app.emit("cc://install", InstallEvent::Done { info, error: None });
                        return;
                    }
                    last_err = Some(format!(
                        "{label} finished but the claude binary was not found afterwards."
                    ));
                }
                Ok(status) => last_err = Some(format!("{label} exited with {status}.")),
                Err(e) => last_err = Some(format!("{label}: {e}")),
            }
        }

        let info = claude_code_detect();
        let error = if info.available {
            None
        } else {
            last_err.or(Some("Install failed.".into()))
        };
        let _ = app.emit("cc://install", InstallEvent::Done { info, error });
    });
    Ok(())
}

/// Stop a CLI run so that nothing it started outlives it. SIGKILL gives the
/// CLI no chance to clean up, and the shells its Bash tool spawns run in their
/// own process groups — they were left orphaned, still running whatever was
/// cancelled. SIGTERM first lets the CLI take them down; SIGKILL only if it
/// hasn't exited after a grace period. Runs off-thread: never blocks a command.
pub fn stop_child(mut child: Child) {
    std::thread::spawn(move || {
        #[cfg(unix)]
        {
            let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    });
}

#[tauri::command]
pub fn claude_code_cancel(state: State<ClaudeCodeState>, run_id: String) -> Result<(), String> {
    if let Some(child) = state.children.lock().unwrap().remove(&run_id) {
        stop_child(child);
    }
    Ok(())
}

#[cfg(test)]
mod smoke_tests {
    use super::*;
    use std::process::Stdio;

    /// Live smoke test for the exact spawn path `claude_code_run` uses: the
    /// login-shell environment, the home working directory, and Forge's real
    /// argument list. Proves an agent turn can authenticate off the CLI's own
    /// session — no token, no API key.
    ///
    /// Hits the network and spends subscription usage, so it is opt-in:
    ///     cargo test -- --ignored --nocapture
    #[test]
    #[ignore]
    fn a_real_agent_turn_authenticates() {
        let bin = find_claude().expect("claude CLI not found on PATH");

        let mut cmd = Command::new(&bin);
        apply_shell_env(&mut cmd);
        cmd.arg("-p")
            .arg("reply with exactly: PONG")
            .arg("--system-prompt")
            .arg("You are a smoke test. Reply with exactly what is asked.")
            .arg("--model")
            .arg("claude-opus-5")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--include-partial-messages")
            .arg("--verbose")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let out = cmd.output().expect("failed to spawn claude");
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);

        assert!(
            !stdout.contains("\"is_error\":true") && !stderr.contains("Failed to authenticate"),
            "agent turn failed to authenticate.\nstdout tail: {}\nstderr: {}",
            stdout
                .chars()
                .rev()
                .take(400)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>(),
            stderr
        );
        assert!(stdout.contains("PONG"), "no model output in stream; stderr: {stderr}");
    }
}
