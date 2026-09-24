//! Forge tool bridge: a tiny MCP server on 127.0.0.1 that hands Forge's own
//! tools — and its approval gate — to the Claude Code CLI.
//!
//! Without it the CLI runtime was a second-class citizen: it could not use an
//! agent's memory, connectors, `send_file` or desktop-control tools, and its
//! built-in Bash/Write could not be approved at all (headless runs had them
//! stripped outright). Now every CLI turn gets a per-run MCP endpoint:
//!
//!   * `tools/list` answers with the tool definitions the frontend registered
//!     for that run (plus `permission_prompt` when approvals are on);
//!   * `tools/call` is forwarded to the webview as a `bridge://call` event,
//!     where the real executor runs, and blocks until `bridge_respond` returns
//!     the result;
//!   * `permission_prompt` is wired to the CLI's `--permission-prompt-tool`,
//!     so each Bash/Write/Edit the CLI wants goes through the same approval as
//!     the API runtime's tools — the in-app dialog, or the owner's phone.
//!
//! The endpoint listens on loopback only and every request must carry a
//! per-launch bearer secret, so another local process cannot drive it.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, State};

/// The name the CLI is told to call for permission decisions.
pub const PERMISSION_TOOL: &str = "permission_prompt";

/// How long a forwarded call may take. Covers a phone approval (the frontend
/// times those out sooner) plus a slow tool.
const CALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

struct RunTools {
    tools: Vec<Value>,
    approvals: bool,
}

#[derive(Default)]
pub struct Inner {
    runs: Mutex<HashMap<String, RunTools>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next_call: AtomicU64,
}

/// How a forwarded call reaches whoever answers it: the webview in the app,
/// a stub in tests.
type Emit = Arc<dyn Fn(Arc<Inner>, BridgeCall) + Send + Sync>;

pub struct BridgeState {
    port: u16,
    secret: String,
    inner: Arc<Inner>,
}

#[derive(Serialize, Clone)]
pub struct BridgeCall {
    call_id: u64,
    run_id: String,
    name: String,
    args: Value,
}

/// 128 bits from two randomly-keyed SipHash states — the std library seeds
/// each `RandomState` from the OS RNG, which is plenty for a loopback bearer.
fn random_secret() -> String {
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(std::process::id() as u64);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

impl BridgeState {
    /// Bind the loopback server and start serving. Returns a disabled bridge
    /// (port 0) if binding fails, so the app still launches without it.
    pub fn start(app: tauri::AppHandle) -> Self {
        Self::start_with(Arc::new(move |_inner, call| {
            let _ = app.emit("bridge://call", call);
        }))
    }

    fn start_with(emit: Emit) -> Self {
        let secret = random_secret();
        let inner = Arc::new(Inner::default());
        let Ok(server) = tiny_http::Server::http("127.0.0.1:0") else {
            return Self { port: 0, secret, inner };
        };
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let server = Arc::new(server);

        let (inner2, secret2) = (inner.clone(), secret.clone());
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let (inner, secret, emit) = (inner2.clone(), secret2.clone(), emit.clone());
                // One thread per request: a call can block for minutes on an
                // approval, and must not hold up other runs' calls meanwhile.
                std::thread::spawn(move || handle(request, &inner, &secret, &emit));
            }
        });
        Self { port, secret, inner }
    }

    pub fn available(&self) -> bool {
        self.port != 0
    }

    /// Register a run's tools; the MCP config entry the CLI should mount.
    pub fn register(&self, run_id: &str, tools: Vec<Value>, approvals: bool) -> Value {
        self.inner
            .runs
            .lock()
            .unwrap()
            .insert(run_id.to_string(), RunTools { tools, approvals });
        json!({
            "type": "http",
            "url": format!("http://127.0.0.1:{}/mcp/{run_id}", self.port),
            "headers": { "Authorization": format!("Bearer {}", self.secret) },
        })
    }

    pub fn unregister(&self, run_id: &str) {
        self.inner.runs.lock().unwrap().remove(run_id);
    }
}

fn respond_json(request: tiny_http::Request, status: u16, body: &Value) {
    let data = body.to_string();
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    let _ = request.respond(tiny_http::Response::from_string(data).with_status_code(status).with_header(header));
}

fn respond_empty(request: tiny_http::Request, status: u16) {
    let _ = request.respond(tiny_http::Response::empty(status));
}

fn handle(mut request: tiny_http::Request, inner: &Arc<Inner>, secret: &str, emit: &Emit) {
    let authorised = request
        .headers()
        .iter()
        .any(|h| h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {secret}"));
    let Some(run_id) = request.url().strip_prefix("/mcp/").map(|s| s.split('?').next().unwrap_or("").to_string())
    else {
        return respond_empty(request, 404);
    };
    if !authorised {
        return respond_empty(request, 401);
    }
    match request.method() {
        tiny_http::Method::Post => {}
        // Session teardown is a no-op; we keep no per-session state.
        tiny_http::Method::Delete => return respond_empty(request, 200),
        // No server-initiated stream: every answer rides on its POST.
        _ => return respond_empty(request, 405),
    }

    let mut body = String::new();
    if request.as_reader().take(4_000_000).read_to_string(&mut body).is_err() {
        return respond_empty(request, 400);
    }
    let Ok(msg) = serde_json::from_str::<Value>(&body) else {
        return respond_json(request, 400, &rpc_error(Value::Null, -32700, "Parse error"));
    };
    // Notifications carry no id and expect no body.
    let Some(id) = msg.get("id").cloned() else {
        return respond_empty(request, 202);
    };
    let reply = dispatch(&run_id, &msg, id, inner, emit);
    respond_json(request, 200, &reply);
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn permission_tool_def() -> Value {
    json!({
        "name": PERMISSION_TOOL,
        "description": "Internal: asks the user to approve a Claude Code tool call. Never call this yourself.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tool_name": { "type": "string" },
                "input": { "type": "object" },
                "tool_use_id": { "type": "string" }
            },
            "required": ["tool_name", "input"]
        }
    })
}

fn dispatch(run_id: &str, msg: &Value, id: Value, inner: &Arc<Inner>, emit: &Emit) -> Value {
    let method = msg["method"].as_str().unwrap_or("");
    match method {
        "initialize" => {
            let version = msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18");
            rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "forge", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => {
            let runs = inner.runs.lock().unwrap();
            let Some(run) = runs.get(run_id) else {
                return rpc_result(id, json!({ "tools": [] }));
            };
            let mut tools = run.tools.clone();
            if run.approvals {
                tools.push(permission_tool_def());
            }
            rpc_result(id, json!({ "tools": tools }))
        }
        "tools/call" => {
            if !inner.runs.lock().unwrap().contains_key(run_id) {
                return rpc_error(id, -32602, "This run has finished.");
            }
            let name = msg["params"]["name"].as_str().unwrap_or("").to_string();
            let args = msg["params"]["arguments"].clone();
            rpc_result(id, forward_call(run_id, name, args, inner, emit))
        }
        _ => rpc_error(id, -32601, "Method not found"),
    }
}

/// Hand a tool call to the webview and wait for its answer.
fn forward_call(run_id: &str, name: String, args: Value, inner: &Arc<Inner>, emit: &Emit) -> Value {
    let call_id = inner.next_call.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    inner.pending.lock().unwrap().insert(call_id, tx);
    emit(inner.clone(), BridgeCall { call_id, run_id: run_id.to_string(), name: name.clone(), args });

    let result = rx.recv_timeout(CALL_TIMEOUT);
    inner.pending.lock().unwrap().remove(&call_id);
    match result {
        Ok(v) => v,
        Err(_) if name == PERMISSION_TOOL => text_result(
            &json!({ "behavior": "deny", "message": "Nobody answered the approval in time." }).to_string(),
            false,
        ),
        Err(_) => text_result("Forge did not answer this tool call in time.", true),
    }
}

fn text_result(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

/// The webview's answer to a `bridge://call`. `content` is an MCP content
/// array (text and image items).
#[tauri::command]
pub fn bridge_respond(state: State<BridgeState>, call_id: u64, content: Value, is_error: bool) -> Result<(), String> {
    respond(&state.inner, call_id, content, is_error);
    Ok(())
}

fn respond(inner: &Inner, call_id: u64, content: Value, is_error: bool) {
    if let Some(tx) = inner.pending.lock().unwrap().remove(&call_id) {
        let _ = tx.send(json!({ "content": content, "isError": is_error }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner_with(run: &str, approvals: bool) -> Inner {
        let inner = Inner::default();
        inner.runs.lock().unwrap().insert(
            run.into(),
            RunTools { tools: vec![json!({ "name": "remember", "inputSchema": { "type": "object" } })], approvals },
        );
        inner
    }

    #[test]
    fn secrets_are_long_and_differ_per_launch() {
        let (a, b) = (random_secret(), random_secret());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn permission_tool_is_listed_only_when_approvals_are_on() {
        let names = |inner: &Inner| -> Vec<String> {
            let runs = inner.runs.lock().unwrap();
            let run = runs.get("r").unwrap();
            let mut tools = run.tools.clone();
            if run.approvals {
                tools.push(permission_tool_def());
            }
            tools.iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
        };
        assert_eq!(names(&inner_with("r", true)), vec!["remember", PERMISSION_TOOL]);
        assert_eq!(names(&inner_with("r", false)), vec!["remember"]);
    }

    #[test]
    fn rpc_envelopes_echo_the_request_id() {
        assert_eq!(rpc_result(json!(7), json!({}))["id"], 7);
        let err = rpc_error(json!("x"), -32601, "Method not found");
        assert_eq!(err["id"], "x");
        assert_eq!(err["error"]["code"], -32601);
    }

    /// Drives the real `claude` CLI against the real bridge server: the CLI
    /// must route its Bash permission through `permission_prompt` and call a
    /// Forge tool over MCP. Spends a little subscription usage, so opt-in:
    ///     cargo test bridge -- --ignored --nocapture
    #[test]
    #[ignore]
    fn the_real_cli_asks_forge_for_permission_and_calls_forge_tools() {
        use std::process::Command;
        let calls: Arc<Mutex<Vec<String>>> = Arc::default();
        let seen = calls.clone();
        let bridge = BridgeState::start_with(Arc::new(move |inner, call| {
            seen.lock().unwrap().push(call.name.clone());
            let text = if call.name == PERMISSION_TOOL {
                json!({ "behavior": "allow", "updatedInput": call.args["input"] }).to_string()
            } else {
                "Saved to memory.".to_string()
            };
            std::thread::spawn(move || respond(&inner, call.call_id, json!([{ "type": "text", "text": text }]), false));
        }));
        assert!(bridge.available());
        let entry = bridge.register(
            "smoke",
            vec![json!({ "name": "remember", "description": "Save a fact to memory",
                         "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } })],
            true,
        );
        let cfg = std::env::temp_dir().join("forge-bridge-smoke.json");
        std::fs::write(&cfg, json!({ "mcpServers": { "forge": entry } }).to_string()).unwrap();
        let marker = std::env::temp_dir().join("forge_bridge_smoke.txt");
        let _ = std::fs::remove_file(&marker);

        let mut cmd = Command::new("claude");
        crate::claude_code::apply_shell_env(&mut cmd);
        let out = cmd
            .arg("-p")
            .arg(format!(
                "Run this exact shell command: date > {}. Then call the remember tool with text 'smoke ok'. Reply DONE.",
                marker.display()
            ))
            .args(["--model", "claude-haiku-4-5", "--output-format", "json"])
            .arg("--mcp-config")
            .arg(&cfg)
            .args(["--allowedTools", "mcp__forge"])
            .args(["--permission-prompt-tool", &format!("mcp__forge__{PERMISSION_TOOL}")])
            .output()
            .expect("claude CLI not found");
        let _ = std::fs::remove_file(&cfg);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let names = calls.lock().unwrap().clone();
        assert!(names.iter().any(|n| n == PERMISSION_TOOL), "no permission prompt reached Forge: {names:?}\n{stdout}");
        assert!(names.iter().any(|n| n == "remember"), "Forge tool never called: {names:?}\n{stdout}");
        assert!(marker.exists(), "approved command did not run\n{stdout}");
        let _ = std::fs::remove_file(&marker);
    }
}
