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

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::bridge::{BridgeState, PERMISSION_TOOL};

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
fn find_claude() -> Option<PathBuf> {
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

#[tauri::command]
pub fn claude_code_detect() -> ClaudeCodeInfo {
    let Some(bin) = find_claude() else {
        return ClaudeCodeInfo { available: false, version: String::new(), path: String::new() };
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
    Done { info: ClaudeCodeInfo, error: Option<String> },
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
                child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ]
            .into_iter()
            .flatten()
            {
                let app2 = app.clone();
                threads.push(std::thread::spawn(move || {
                    for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            let _ = app2
                                .emit("cc://install", InstallEvent::Line { text: trimmed.to_string() });
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
        let error = if info.available { None } else { last_err.or(Some("Install failed.".into())) };
        let _ = app.emit("cc://install", InstallEvent::Done { info, error });
    });
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind")]
enum CcEvent {
    #[serde(rename = "text")]
    Text { run_id: String, text: String },
    /// A tool the CLI ran (Bash, Read, an MCP tool…): once with `input` when
    /// it starts, again with `output` when its result comes back.
    #[serde(rename = "tool")]
    Tool {
        run_id: String,
        id: String,
        name: String,
        input: Option<serde_json::Value>,
        output: Option<String>,
        status: String,
    },
    #[serde(rename = "done")]
    Done {
        run_id: String,
        session_id: String,
        input_tokens: u64,
        output_tokens: u64,
        text: String,
        error: Option<String>,
    },
}

/// Spawn a Claude Code turn. `resume` is the prior session id (empty for the
/// first turn). Streams `cc://event` payloads; the frontend filters by run_id.
/// `mcp_config` is the pack's `--mcp-config` JSON (empty = none); `env` is the
/// pack's environment, applied to the CLI process (and thus its MCP servers).
#[tauri::command]
pub fn claude_code_run(
    app: tauri::AppHandle,
    state: State<ClaudeCodeState>,
    run_id: String,
    model: String,
    system: String,
    prompt: String,
    resume: String,
    mcp_config: Option<String>,
    env: Option<HashMap<String, String>>,
    disallowed_tools: Option<Vec<String>>,
    bridge_tools: Option<Vec<serde_json::Value>>,
    approvals: Option<bool>,
) -> Result<(), String> {
    let bin = find_claude().ok_or_else(|| "Claude Code CLI not found on this machine.".to_string())?;

    let mut cmd = Command::new(&bin);
    // Run with the user's terminal environment so the CLI can reach node,
    // security, and its credential store — otherwise it 401s as "not signed in".
    apply_shell_env(&mut cmd);
    cmd.arg("-p").arg(&prompt);
    if let Some(vars) = env {
        // Pack/token env layered on top of the shell env, so it takes precedence.
        cmd.envs(vars);
    }
    // Unattended runs (channels, schedules) withhold the CLI's own machine
    // tools. Forge gates its in-app tools with an approval dialog, but the CLI
    // carries Read/Write/Bash of its own that the dialog never sees — without
    // this, a headless turn on this runtime could touch the machine unasked.
    if let Some(deny) = disallowed_tools.filter(|d| !d.is_empty()) {
        cmd.arg("--disallowed-tools").args(&deny);
    }
    // Mount Forge's own tool bridge next to the pack's MCP servers: the
    // agent's Forge tools, and (with approvals on) the permission prompt that
    // routes every Bash/Write the CLI wants through Forge's approval gate.
    let bridge = app.state::<BridgeState>();
    let approvals = approvals.unwrap_or(false);
    let use_bridge = bridge.available() && (approvals || bridge_tools.as_ref().is_some_and(|t| !t.is_empty()));
    let mcp_config = if use_bridge {
        let entry = bridge.register(&run_id, bridge_tools.unwrap_or_default(), approvals);
        let mut cfg: serde_json::Value = mcp_config
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok())
            .unwrap_or_else(|| serde_json::json!({ "mcpServers": {} }));
        cfg["mcpServers"]["forge"] = entry;
        // Forge's tools gate themselves; don't make the CLI ask again.
        cmd.arg("--allowedTools").arg("mcp__forge");
        if approvals {
            cmd.arg("--permission-prompt-tool").arg(format!("mcp__forge__{PERMISSION_TOOL}"));
        }
        Some(cfg.to_string())
    } else {
        mcp_config
    };
    let mut mcp_config_path: Option<PathBuf> = None;
    if let Some(cfg) = mcp_config.filter(|c| !c.trim().is_empty()) {
        // The CLI takes a file path; drop the JSON in the temp dir per run.
        let path = std::env::temp_dir().join(format!("forge-mcp-{run_id}.json"));
        std::fs::write(&path, cfg).map_err(|e| format!("Failed to write MCP config: {e}"))?;
        // It carries the bridge's bearer secret: owner-only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        cmd.arg("--mcp-config").arg(&path);
        mcp_config_path = Some(path);
    }
    if resume.is_empty() {
        // Fresh session: set identity + model.
        if !system.is_empty() {
            cmd.arg("--system-prompt").arg(&system);
        }
        if !model.is_empty() {
            cmd.arg("--model").arg(&model);
        }
    } else {
        // Continue the existing session (identity/model already bound).
        cmd.arg("--resume").arg(&resume);
    }
    cmd.arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        bridge.unregister(&run_id);
        format!("Failed to start claude: {e}")
    })?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    state.children.lock().unwrap().insert(run_id.clone(), child);

    // Watchdog. A CLI that wedges — no output, never exits — would otherwise
    // pin the run forever: the UI keeps its spinner and the agent is stuck with
    // no error and no way back. Kill it once it has been silent too long.
    // Silence, not duration, is the signal; a long think still streams events.
    const IDLE_TIMEOUT: Duration = Duration::from_secs(180);
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let finished = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    {
        let app_wd = app.clone();
        let run_wd = run_id.clone();
        let last = last_activity.clone();
        let fin = finished.clone();
        let timed = timed_out.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));
            if fin.load(Ordering::Relaxed) {
                return;
            }
            let idle = last.lock().map(|t| t.elapsed()).unwrap_or_default();
            if idle > IDLE_TIMEOUT {
                timed.store(true, Ordering::Relaxed);
                if let Some(c) = app_wd
                    .state::<ClaudeCodeState>()
                    .children
                    .lock()
                    .unwrap()
                    .remove(&run_wd)
                {
                    stop_child(c);
                }
                return;
            }
        });
    }

    let app2 = app.clone();
    let run_id2 = run_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut text = String::new();
        let mut session_id = resume.clone();
        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;
        let mut error: Option<String> = None;

        for line in reader.lines() {
            let Ok(line) = line else { break };
            if let Ok(mut t) = last_activity.lock() {
                *t = Instant::now();
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            match json.get("type").and_then(|v| v.as_str()) {
                Some("system") => {
                    if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                        session_id = sid.to_string();
                    }
                }
                Some("stream_event") => {
                    let ev = &json["event"];
                    match ev.get("type").and_then(|v| v.as_str()) {
                        Some("message_start") => {
                            input_tokens = ev["message"]["usage"]["input_tokens"].as_u64().unwrap_or(input_tokens);
                        }
                        Some("content_block_delta") => {
                            let d = &ev["delta"];
                            if d.get("type").and_then(|v| v.as_str()) == Some("text_delta") {
                                if let Some(t) = d.get("text").and_then(|v| v.as_str()) {
                                    text.push_str(t);
                                    let _ = app2.emit(
                                        "cc://event",
                                        CcEvent::Text { run_id: run_id2.clone(), text: t.to_string() },
                                    );
                                }
                            }
                        }
                        Some("message_delta") => {
                            output_tokens = ev["usage"]["output_tokens"].as_u64().unwrap_or(output_tokens);
                        }
                        _ => {}
                    }
                }
                // Whole assistant messages carry the tool calls with their input…
                Some("assistant") => {
                    for block in json["message"]["content"].as_array().into_iter().flatten() {
                        if block["type"] == "tool_use" {
                            let _ = app2.emit(
                                "cc://event",
                                CcEvent::Tool {
                                    run_id: run_id2.clone(),
                                    id: block["id"].as_str().unwrap_or("").into(),
                                    name: block["name"].as_str().unwrap_or("tool").into(),
                                    input: Some(block["input"].clone()),
                                    output: None,
                                    status: "running".into(),
                                },
                            );
                        }
                    }
                }
                // …and the following user message carries their results.
                Some("user") => {
                    for block in json["message"]["content"].as_array().into_iter().flatten() {
                        if block["type"] == "tool_result" {
                            let _ = app2.emit(
                                "cc://event",
                                CcEvent::Tool {
                                    run_id: run_id2.clone(),
                                    id: block["tool_use_id"].as_str().unwrap_or("").into(),
                                    name: String::new(),
                                    input: None,
                                    output: Some(tool_result_text(&block["content"])),
                                    status: if block["is_error"].as_bool() == Some(true) { "error" } else { "done" }.into(),
                                },
                            );
                        }
                    }
                }
                Some("result") => {
                    if json.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
                        error = json
                            .get("result")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or(Some("Claude Code reported an error.".into()));
                    }
                    if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                        session_id = sid.to_string();
                    }
                    input_tokens = json["usage"]["input_tokens"].as_u64().unwrap_or(input_tokens);
                    output_tokens = json["usage"]["output_tokens"].as_u64().unwrap_or(output_tokens);
                    // The `result` field carries the full final text; prefer it.
                    if let Some(r) = json.get("result").and_then(|v| v.as_str()) {
                        if !r.is_empty() && error.is_none() {
                            text = r.to_string();
                        }
                    }
                }
                _ => {}
            }
        }

        // Drain the child + surface a non-zero exit as an error.
        if let Some(mut c) = app2
            .state::<ClaudeCodeState>()
            .children
            .lock()
            .unwrap()
            .remove(&run_id2)
        {
            if let Ok(status) = c.wait() {
                if !status.success() && error.is_none() && text.is_empty() {
                    let mut stderr = String::new();
                    if let Some(mut e) = c.stderr.take() {
                        let _ = e.read_to_string(&mut stderr);
                    }
                    error = Some(if stderr.is_empty() {
                        "Claude Code exited unexpectedly.".into()
                    } else {
                        stderr.trim().to_string()
                    });
                }
            }
        }

        finished.store(true, Ordering::Relaxed);
        if timed_out.load(Ordering::Relaxed) && error.is_none() {
            error = Some(format!(
                "Claude Code sent nothing for {}s and was stopped.",
                IDLE_TIMEOUT.as_secs()
            ));
        }

        app2.state::<BridgeState>().unregister(&run_id2);
        // The CLI has read the per-run MCP config by now; don't litter the temp dir.
        if let Some(path) = mcp_config_path {
            let _ = std::fs::remove_file(path);
        }

        let _ = app2.emit(
            "cc://event",
            CcEvent::Done {
                run_id: run_id2.clone(),
                session_id,
                input_tokens,
                output_tokens,
                text,
                error,
            },
        );
    });

    Ok(())
}

/// Flatten a tool_result's content (a string, or text/image blocks) to text,
/// capped so a huge command output doesn't flood the IPC channel.
fn tool_result_text(content: &serde_json::Value) -> String {
    let text = match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(|i| match i["type"].as_str() {
                Some("text") => i["text"].as_str().unwrap_or("").to_string(),
                Some("image") => "[image]".to_string(),
                _ => String::new(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    text.chars().take(4000).collect()
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
            stdout.chars().rev().take(400).collect::<String>().chars().rev().collect::<String>(),
            stderr
        );
        assert!(stdout.contains("PONG"), "no model output in stream; stderr: {stderr}");
    }
}
