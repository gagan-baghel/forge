//! One Claude Code turn: build the command, spawn it, stream its output,
//! watch for a wedged CLI, and clean up whatever happens.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};

use super::env::{apply_shell_env, find_claude};
use super::stream::StreamState;
use super::{stop_child, ClaudeCodeState};
use crate::bridge::{BridgeState, PERMISSION_TOOL};

/// A CLI that wedges — no output, never exits — would otherwise pin the run
/// forever. Silence, not duration, is the signal; a long think still streams.
const IDLE_TIMEOUT: Duration = Duration::from_secs(180);
const WATCHDOG_TICK: Duration = Duration::from_secs(5);
const EVENT: &str = "cc://event";

/// Spawn a Claude Code turn. `resume` is the prior session id (empty for the
/// first turn). Streams `cc://event` payloads; the frontend filters by run_id.
/// `mcp_config` is the pack's `--mcp-config` JSON (empty = none); `env` is the
/// pack's environment, applied to the CLI process (and thus its MCP servers).
// The arguments are the JS invoke payload, one per field; bundling them into a
// struct would only move the list.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn claude_code_run(
    app: AppHandle,
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

    let bridge = app.state::<BridgeState>();
    let mcp_config = mount_bridge(
        &mut cmd,
        &bridge,
        &run_id,
        mcp_config,
        bridge_tools,
        approvals.unwrap_or(false),
    );
    let mcp_config_path = write_mcp_config(&mut cmd, &run_id, mcp_config)?;
    session_args(&mut cmd, &resume, &system, &model);
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

    let watchdog = Watchdog::spawn(app.clone(), run_id.clone());
    std::thread::spawn(move || {
        let mut stream = StreamState::new(run_id.clone(), resume);
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            watchdog.touch();
            for event in stream.apply_line(&line) {
                let _ = app.emit(EVENT, event);
            }
        }
        if stream.error.is_none() && stream.text.is_empty() {
            stream.error = reap_child(&app, &run_id);
        } else {
            let _ = reap_child(&app, &run_id);
        }
        if watchdog.finish() && stream.error.is_none() {
            stream.error = Some(format!(
                "Claude Code sent nothing for {}s and was stopped.",
                IDLE_TIMEOUT.as_secs()
            ));
        }
        app.state::<BridgeState>().unregister(&run_id);
        // The CLI has read the per-run MCP config by now; don't litter the temp dir.
        if let Some(path) = mcp_config_path {
            let _ = std::fs::remove_file(path);
        }
        let _ = app.emit(EVENT, stream.into_done());
    });

    Ok(())
}

/// Mount Forge's own tool bridge next to the pack's MCP servers: the agent's
/// Forge tools, and (with approvals on) the permission prompt that routes
/// every Bash/Write the CLI wants through Forge's approval gate.
fn mount_bridge(
    cmd: &mut Command,
    bridge: &BridgeState,
    run_id: &str,
    mcp_config: Option<String>,
    bridge_tools: Option<Vec<serde_json::Value>>,
    approvals: bool,
) -> Option<String> {
    let has_tools = bridge_tools.as_ref().is_some_and(|t| !t.is_empty());
    if !bridge.available() || !(approvals || has_tools) {
        return mcp_config;
    }
    let entry = bridge.register(run_id, bridge_tools.unwrap_or_default(), approvals);
    let mut cfg: serde_json::Value = mcp_config
        .as_deref()
        .and_then(|c| serde_json::from_str(c).ok())
        .unwrap_or_else(|| serde_json::json!({ "mcpServers": {} }));
    cfg["mcpServers"]["forge"] = entry;
    // Forge's tools gate themselves; don't make the CLI ask again.
    cmd.arg("--allowedTools").arg("mcp__forge");
    if approvals {
        cmd.arg("--permission-prompt-tool")
            .arg(format!("mcp__forge__{PERMISSION_TOOL}"));
    }
    Some(cfg.to_string())
}

/// The CLI takes `--mcp-config` as a file path; write it per run, owner-only
/// (it carries the bridge's bearer secret).
fn write_mcp_config(cmd: &mut Command, run_id: &str, cfg: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(cfg) = cfg.filter(|c| !c.trim().is_empty()) else {
        return Ok(None);
    };
    let path = std::env::temp_dir().join(format!("forge-mcp-{run_id}.json"));
    std::fs::write(&path, cfg).map_err(|e| format!("Failed to write MCP config: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    cmd.arg("--mcp-config").arg(&path);
    Ok(Some(path))
}

fn session_args(cmd: &mut Command, resume: &str, system: &str, model: &str) {
    if !resume.is_empty() {
        // Continue the existing session (identity/model already bound).
        cmd.arg("--resume").arg(resume);
        return;
    }
    // Fresh session: set identity + model.
    if !system.is_empty() {
        cmd.arg("--system-prompt").arg(system);
    }
    if !model.is_empty() {
        cmd.arg("--model").arg(model);
    }
}

/// Wait for the child to exit; a non-zero exit becomes the error (its stderr,
/// when it printed any).
fn reap_child(app: &AppHandle, run_id: &str) -> Option<String> {
    let mut c = app.state::<ClaudeCodeState>().children.lock().unwrap().remove(run_id)?;
    let status = c.wait().ok()?;
    if status.success() {
        return None;
    }
    let mut stderr = String::new();
    if let Some(mut e) = c.stderr.take() {
        let _ = e.read_to_string(&mut stderr);
    }
    Some(if stderr.is_empty() {
        "Claude Code exited unexpectedly.".into()
    } else {
        stderr.trim().to_string()
    })
}

/// Kills a run once it has been silent for IDLE_TIMEOUT.
struct Watchdog {
    last_activity: Arc<Mutex<Instant>>,
    finished: Arc<AtomicBool>,
    timed_out: Arc<AtomicBool>,
}

impl Watchdog {
    fn spawn(app: AppHandle, run_id: String) -> Self {
        let dog = Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            finished: Arc::new(AtomicBool::new(false)),
            timed_out: Arc::new(AtomicBool::new(false)),
        };
        let (last, fin, timed) = (dog.last_activity.clone(), dog.finished.clone(), dog.timed_out.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(WATCHDOG_TICK);
            if fin.load(Ordering::Relaxed) {
                return;
            }
            if last.lock().map(|t| t.elapsed()).unwrap_or_default() > IDLE_TIMEOUT {
                timed.store(true, Ordering::Relaxed);
                if let Some(c) = app.state::<ClaudeCodeState>().children.lock().unwrap().remove(&run_id) {
                    stop_child(c);
                }
                return;
            }
        });
        dog
    }

    fn touch(&self) {
        if let Ok(mut t) = self.last_activity.lock() {
            *t = Instant::now();
        }
    }

    /// Stop watching; returns whether the run was killed for silence.
    fn finish(&self) -> bool {
        self.finished.store(true, Ordering::Relaxed);
        self.timed_out.load(Ordering::Relaxed)
    }
}
