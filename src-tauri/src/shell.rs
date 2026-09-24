//! One-shot shell execution for agent tools.
//!
//! Distinct from `pty.rs`, which drives the interactive terminal the user types
//! into. This runs a single command to completion and hands back its output, so
//! an agent can act on the machine. Every call is gated by an approval prompt on
//! the frontend (see `lib/approval.ts`) — nothing reaches here unapproved.

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// Running commands by caller-supplied id, so `/stop` can end one: pid of the
/// process-group leader (the shell), whose whole group is signalled.
fn running() -> &'static Mutex<HashMap<String, u32>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Output cap per stream. A runaway command must not blow up the context window
/// (or the IPC message) — the agent gets the head of the output and a marker.
const MAX_STREAM_BYTES: usize = 24_000;

#[derive(Serialize)]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

fn truncate(mut s: String) -> String {
    if s.len() > MAX_STREAM_BYTES {
        // Cut on a char boundary so the String stays valid UTF-8.
        let mut end = MAX_STREAM_BYTES;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n… [output truncated]");
    }
    s
}

/// Async so a long command runs off the main thread instead of freezing the UI.
/// `id` makes it cancellable with `shell_cancel`.
#[tauri::command]
pub async fn shell_exec(command: String, cwd: Option<String>, id: Option<String>) -> Result<ShellOutput, String> {
    tauri::async_runtime::spawn_blocking(move || exec_tracked(command, cwd, id))
        .await
        .map_err(|e| e.to_string())?
}

/// End a running command and everything it started (its whole process group).
#[tauri::command]
pub fn shell_cancel(id: String) -> Result<(), String> {
    if let Some(pid) = running().lock().unwrap().remove(&id) {
        #[cfg(unix)]
        {
            let _ = Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                let _ = Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
            });
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
        }
    }
    Ok(())
}

#[cfg(test)]
fn exec(command: String, cwd: Option<String>) -> Result<ShellOutput, String> {
    exec_tracked(command, cwd, None)
}

fn exec_tracked(command: String, cwd: Option<String>, id: Option<String>) -> Result<ShellOutput, String> {
    if command.trim().is_empty() {
        return Err("Empty command.".into());
    }

    let shell = if cfg!(windows) { "powershell.exe" } else { "/bin/sh" };
    let flag = if cfg!(windows) { "-Command" } else { "-c" };

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(&command);
    // Same environment fix-up the Claude Code bridge needs: a Finder/Dock launch
    // inherits no login-shell PATH, so `git`, `node` etc. would not resolve.
    crate::claude_code::apply_shell_env(&mut cmd);
    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.current_dir(dir);
    }

    // Its own process group, so a cancel reaches everything the command spawns.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run command: {e}"))?;
    if let Some(id) = &id {
        running().lock().unwrap().insert(id.clone(), child.id());
    }
    let out = child.wait_with_output();
    if let Some(id) = &id {
        running().lock().unwrap().remove(id);
    }
    let out = out.map_err(|e| format!("Failed to run command: {e}"))?;

    Ok(ShellOutput {
        stdout: truncate(String::from_utf8_lossy(&out.stdout).into_owned()),
        stderr: truncate(String::from_utf8_lossy(&out.stderr).into_owned()),
        code: out.status.code().unwrap_or(-1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_a_command_and_captures_stdout() {
        let out = exec("echo hello".into(), None).unwrap();
        assert_eq!(out.code, 0);
        assert_eq!(out.stdout.trim(), "hello");
        assert!(out.stderr.is_empty());
    }

    #[test]
    fn reports_a_failing_exit_code_and_stderr() {
        let out = exec("echo oops >&2; exit 3".into(), None).unwrap();
        assert_eq!(out.code, 3);
        assert!(out.stderr.contains("oops"));
    }

    #[test]
    fn honors_the_working_directory() {
        let out = exec("pwd".into(), Some("/tmp".into())).unwrap();
        // macOS reports /tmp as the symlink target /private/tmp.
        assert!(out.stdout.contains("tmp"), "got {:?}", out.stdout);
    }

    #[test]
    fn cancel_ends_the_command_and_its_children() {
        let marker = std::env::temp_dir().join("forge_shell_cancel_test");
        let _ = std::fs::remove_file(&marker);
        let cmd = format!("sleep 30 && touch {}", marker.display());
        let t = std::thread::spawn(move || exec_tracked(cmd, None, Some("t1".into())));
        std::thread::sleep(std::time::Duration::from_millis(500));
        let started = std::time::Instant::now();
        shell_cancel("t1".into()).unwrap();
        let out = t.join().unwrap().unwrap();
        assert!(started.elapsed().as_secs() < 5, "cancel took {:?}", started.elapsed());
        assert_ne!(out.code, 0);
        assert!(!marker.exists());
    }

    #[test]
    fn rejects_an_empty_command() {
        assert!(exec("   ".into(), None).is_err());
    }

    #[test]
    fn caps_runaway_output() {
        let out = exec(format!("yes x | head -c {}", MAX_STREAM_BYTES * 3), None).unwrap();
        assert!(out.stdout.len() < MAX_STREAM_BYTES + 100, "len {}", out.stdout.len());
        assert!(out.stdout.ends_with("[output truncated]"));
    }

    #[test]
    fn truncation_never_splits_a_utf8_char() {
        // A multi-byte char straddling the cut point must not corrupt the String.
        let s = "é".repeat(MAX_STREAM_BYTES);
        let cut = truncate(s);
        assert!(cut.ends_with("[output truncated]"));
        // Round-tripping proves the bytes are still valid UTF-8.
        assert_eq!(cut, String::from_utf8(cut.clone().into_bytes()).unwrap());
    }
}
