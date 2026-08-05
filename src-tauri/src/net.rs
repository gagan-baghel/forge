//! Native HTTP fetch. Lets tools and connectors call third-party APIs without
//! the browser CORS wall (Slack, GitHub, etc. block direct browser calls).
//! Runs blocking on a worker thread via the Tauri async runtime.

use std::collections::HashMap;
use std::io::Read;

use serde::Serialize;

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

#[tauri::command]
pub async fn http_fetch(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(45))
            .build();
        let mut req = agent.request(&method, &url);
        for (k, v) in &headers {
            req = req.set(k, v);
        }
        let result = match body {
            Some(b) if !b.is_empty() => req.send_string(&b),
            _ => req.call(),
        };

        // ureq returns Err for non-2xx; capture the response either way.
        let (status, reader) = match result {
            Ok(resp) => (resp.status(), resp.into_reader()),
            Err(ureq::Error::Status(code, resp)) => (code, resp.into_reader()),
            Err(e) => return Err(format!("request failed: {e}")),
        };
        let mut text = String::new();
        let _ = reader
            .take(2_000_000)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string());
        Ok(HttpResponse {
            status,
            ok: (200..300).contains(&status),
            body: text,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
