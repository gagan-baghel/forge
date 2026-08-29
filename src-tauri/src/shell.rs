//! One-shot shell execution for agent tools.
//!
//! Distinct from `pty.rs`, which drives the interactive terminal the user types
//! into. This runs a single command to completion and hands back its output, so
//! an agent can act on the machine. Every call is gated by an approval prompt on
//! the frontend (see `lib/approval.ts`) — nothing reaches here unapproved.

use std::process::{Command, Stdio};

use serde::Serialize;

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

#[tauri::command]
pub fn shell_exec(command: String, cwd: Option<String>) -> Result<ShellOutput, String> {
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

    let out = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run command: {e}"))?;

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
        let out = shell_exec("echo hello".into(), None).unwrap();
        assert_eq!(out.code, 0);
        assert_eq!(out.stdout.trim(), "hello");
        assert!(out.stderr.is_empty());
    }

    #[test]
    fn reports_a_failing_exit_code_and_stderr() {
        let out = shell_exec("echo oops >&2; exit 3".into(), None).unwrap();
        assert_eq!(out.code, 3);
        assert!(out.stderr.contains("oops"));
    }

    #[test]
    fn honors_the_working_directory() {
        let out = shell_exec("pwd".into(), Some("/tmp".into())).unwrap();
        // macOS reports /tmp as the symlink target /private/tmp.
        assert!(out.stdout.contains("tmp"), "got {:?}", out.stdout);
    }

    #[test]
    fn rejects_an_empty_command() {
        assert!(shell_exec("   ".into(), None).is_err());
    }

    #[test]
    fn caps_runaway_output() {
        let out = shell_exec(format!("yes x | head -c {}", MAX_STREAM_BYTES * 3), None).unwrap();
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
