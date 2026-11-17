//! Folding the CLI's `stream-json` lines into webview events. Pure: no I/O,
//! so every branch is unit-tested below.

use serde::Serialize;
use serde_json::Value;

/// Cap on a tool result sent over IPC, so a huge command output can't flood it.
const TOOL_RESULT_MAX_CHARS: usize = 4000;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind")]
pub enum CcEvent {
    #[serde(rename = "text")]
    Text { run_id: String, text: String },
    /// A tool the CLI ran (Bash, Read, an MCP tool…): once with `input` when
    /// it starts, again with `output` when its result comes back.
    #[serde(rename = "tool")]
    Tool {
        run_id: String,
        id: String,
        name: String,
        input: Option<Value>,
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

/// Everything learned from a run's output so far.
pub struct StreamState {
    run_id: String,
    pub text: String,
    pub session_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub error: Option<String>,
}

impl StreamState {
    pub fn new(run_id: String, resume: String) -> Self {
        Self {
            run_id,
            text: String::new(),
            session_id: resume,
            input_tokens: 0,
            output_tokens: 0,
            error: None,
        }
    }

    /// Apply one output line; returns the events it produces (often none).
    pub fn apply_line(&mut self, line: &str) -> Vec<CcEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        match serde_json::from_str::<Value>(line) {
            Ok(json) => self.apply(&json),
            Err(_) => Vec::new(),
        }
    }

    fn apply(&mut self, json: &Value) -> Vec<CcEvent> {
        match json.get("type").and_then(Value::as_str) {
            Some("system") => {
                self.take_session(json);
                Vec::new()
            }
            Some("stream_event") => self.stream_event(&json["event"]),
            // Whole assistant messages carry the tool calls with their input…
            Some("assistant") => self.blocks(json, "tool_use", |s, b| s.tool_started(b)),
            // …and the following user message carries their results.
            Some("user") => self.blocks(json, "tool_result", |s, b| s.tool_finished(b)),
            Some("result") => {
                self.result(json);
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn take_session(&mut self, json: &Value) {
        if let Some(sid) = json.get("session_id").and_then(Value::as_str) {
            self.session_id = sid.to_string();
        }
    }

    fn stream_event(&mut self, ev: &Value) -> Vec<CcEvent> {
        match ev.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                self.input_tokens = ev["message"]["usage"]["input_tokens"]
                    .as_u64()
                    .unwrap_or(self.input_tokens);
            }
            Some("content_block_delta") if ev["delta"]["type"] == "text_delta" => {
                if let Some(t) = ev["delta"]["text"].as_str() {
                    self.text.push_str(t);
                    return vec![CcEvent::Text {
                        run_id: self.run_id.clone(),
                        text: t.to_string(),
                    }];
                }
            }
            Some("message_delta") => {
                self.output_tokens = ev["usage"]["output_tokens"].as_u64().unwrap_or(self.output_tokens);
            }
            _ => {}
        }
        Vec::new()
    }

    fn blocks(&self, json: &Value, kind: &str, f: impl Fn(&Self, &Value) -> CcEvent) -> Vec<CcEvent> {
        json["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == kind)
            .map(|b| f(self, b))
            .collect()
    }

    fn tool_started(&self, block: &Value) -> CcEvent {
        CcEvent::Tool {
            run_id: self.run_id.clone(),
            id: block["id"].as_str().unwrap_or("").into(),
            name: block["name"].as_str().unwrap_or("tool").into(),
            input: Some(block["input"].clone()),
            output: None,
            status: "running".into(),
        }
    }

    fn tool_finished(&self, block: &Value) -> CcEvent {
        let failed = block["is_error"].as_bool() == Some(true);
        CcEvent::Tool {
            run_id: self.run_id.clone(),
            id: block["tool_use_id"].as_str().unwrap_or("").into(),
            name: String::new(),
            input: None,
            output: Some(tool_result_text(&block["content"])),
            status: if failed { "error" } else { "done" }.into(),
        }
    }

    fn result(&mut self, json: &Value) {
        if json.get("is_error").and_then(Value::as_bool) == Some(true) {
            self.error = Some(
                json["result"]
                    .as_str()
                    .unwrap_or("Claude Code reported an error.")
                    .to_string(),
            );
        }
        self.take_session(json);
        self.input_tokens = json["usage"]["input_tokens"].as_u64().unwrap_or(self.input_tokens);
        self.output_tokens = json["usage"]["output_tokens"].as_u64().unwrap_or(self.output_tokens);
        // The `result` field carries the full final text; prefer it.
        if let Some(r) = json["result"].as_str() {
            if !r.is_empty() && self.error.is_none() {
                self.text = r.to_string();
            }
        }
    }

    pub fn into_done(self) -> CcEvent {
        CcEvent::Done {
            run_id: self.run_id,
            session_id: self.session_id,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            text: self.text,
            error: self.error,
        }
    }
}

/// Flatten a tool_result's content (a string, or text/image blocks) to text.
fn tool_result_text(content: &Value) -> String {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
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
    text.chars().take(TOOL_RESULT_MAX_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lines: &[&str]) -> (Vec<CcEvent>, StreamState) {
        let mut s = StreamState::new("r".into(), "old".into());
        let events = lines.iter().flat_map(|l| s.apply_line(l)).collect();
        (events, s)
    }

    #[test]
    fn text_deltas_stream_and_accumulate() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}"#;
        let (events, s) = run(&[delta, delta]);
        assert_eq!(events.len(), 2);
        assert_eq!(s.text, "HiHi");
    }

    #[test]
    fn session_tokens_and_final_text_come_from_the_result() {
        let (_, s) = run(&[
            r#"{"type":"system","session_id":"s1"}"#,
            r#"{"type":"result","session_id":"s2","result":"final","usage":{"input_tokens":5,"output_tokens":7}}"#,
        ]);
        assert_eq!(
            (s.session_id.as_str(), s.text.as_str(), s.input_tokens, s.output_tokens),
            ("s2", "final", 5, 7)
        );
        assert!(s.error.is_none());
    }

    #[test]
    fn an_error_result_keeps_the_streamed_text() {
        let (_, s) = run(&[r#"{"type":"result","is_error":true,"result":"401"}"#]);
        assert_eq!(s.error.as_deref(), Some("401"));
        assert_eq!(
            s.session_id, "old",
            "a resumed session id survives a result without one"
        );
    }

    #[test]
    fn tool_calls_and_results_become_tool_events() {
        let (events, _) = run(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":[{"type":"text","text":"nope"},{"type":"image"}]}]}}"#,
        ]);
        assert!(matches!(&events[0], CcEvent::Tool { name, status, .. } if name == "Bash" && status == "running"));
        assert!(
            matches!(&events[1], CcEvent::Tool { output: Some(o), status, .. } if o == "nope\n[image]" && status == "error")
        );
    }

    #[test]
    fn garbage_and_blank_lines_are_ignored() {
        let (events, s) = run(&["", "not json", "{}"]);
        assert!(events.is_empty());
        assert!(s.text.is_empty());
    }

    #[test]
    fn huge_tool_output_is_capped() {
        assert_eq!(
            tool_result_text(&Value::String("x".repeat(10_000))).len(),
            TOOL_RESULT_MAX_CHARS
        );
    }
}
