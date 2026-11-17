//! Finding the `claude` binary and giving it the user's terminal environment.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

/// A GUI app launched from Finder/Dock inherits a minimal environment — a
/// truncated `PATH` and none of the exports a login shell sets up. That breaks
/// the spawned `claude` in a subtle way: in `-p` mode it shells out to `node`
/// and (on macOS) `security` to read its stored credentials, and when those
/// aren't reachable it falls back to unauthenticated and returns a 401. The user
/// then sees "isn't signed in" even though `claude` is logged in in their
/// terminal. We fix this by capturing the user's login-shell environment once
/// and applying it to every spawned process, so the CLI runs exactly as it does
/// in a real terminal. Cached because spawning a shell isn't free.
fn login_shell_env() -> &'static HashMap<String, String> {
    static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();
    CACHE.get_or_init(|| {
        // Start from whatever we already have, then let the login shell win.
        let mut map: HashMap<String, String> = std::env::vars().collect();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        // `-l -c env` sources the profile files (.zprofile/.zshrc, .bash_profile)
        // where Homebrew/nvm/etc. export PATH — the same setup a terminal gets.
        if let Ok(out) = Command::new(&shell).args(["-l", "-c", "env"]).output() {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        map.insert(k.to_string(), v.to_string());
                    }
                }
            }
        }
        map
    })
}

/// Apply the terminal-equivalent environment (and a sane working directory) to
/// a command before we spawn it. Callers that layer their own env vars on top
/// should call this first so those still take precedence.
pub fn apply_shell_env(cmd: &mut Command) {
    let env = login_shell_env();
    // Preserve the app process environment. Some Claude Code auth helpers are
    // process-env driven, and clearing the environment can make `claude -p`
    // report "Not logged in" even when `claude auth status` is valid in the
    // launching terminal. Overlay the login-shell env to fix PATH/HOME for
    // Finder/Dock launches without discarding inherited auth state.
    cmd.envs(env);
    if let Some(home) = env.get("HOME") {
        cmd.current_dir(home);
    }
}

/// Locate the `claude` binary. GUI apps don't inherit the user's shell PATH,
/// so we probe the login-shell PATH plus the common install locations.
pub fn find_claude() -> Option<PathBuf> {
    // 1. Anything on the login-shell PATH (matches what the terminal sees).
    if let Some(path) = login_shell_env().get("PATH") {
        for dir in std::env::split_paths(path) {
            let cand = dir.join("claude");
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    // 2. Well-known locations.
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    if let Some(h) = home {
        candidates.push(h.join(".local/bin/claude"));
        candidates.push(h.join(".claude/local/claude"));
    }
    candidates.into_iter().find(|p| p.is_file())
}
