//! End-to-end test hook — debug builds only, and only when `FORGE_E2E_PORT` is
//! set. Serves `POST /eval` on 127.0.0.1: the body is an async JS function body
//! run in the main webview; its return value comes back as the response. Lets
//! a test script set the app up and inspect it without driving the GUI.
//! Release builds never start it.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, State};

#[derive(Default)]
pub struct E2eState {
    reply: Mutex<Option<mpsc::Sender<String>>>,
}

pub fn start(app: tauri::AppHandle) {
    if !cfg!(debug_assertions) {
        return;
    }
    let Ok(port) = std::env::var("FORGE_E2E_PORT") else { return };
    let Ok(server) = tiny_http::Server::http(format!("127.0.0.1:{port}")) else { return };
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let mut body = String::new();
            let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
            let (tx, rx) = mpsc::channel();
            *app.state::<E2eState>().reply.lock().unwrap() = Some(tx);
            let js = format!(
                "(async()=>{{let v;try{{v=await (async()=>{{{body}\n}})();v=JSON.stringify(v===undefined?null:v)}}\
                 catch(e){{v=JSON.stringify({{e2eError:String(e&&e.stack||e)}})}}\
                 window.__TAURI_INTERNALS__.invoke('e2e_report',{{value:v}})}})()"
            );
            let out = match app.get_webview_window("main") {
                Some(w) if w.eval(&js).is_ok() => rx.recv_timeout(Duration::from_secs(300)).unwrap_or_else(|_| "\"timeout\"".into()),
                _ => "\"no window\"".into(),
            };
            let _ = req.respond(tiny_http::Response::from_string(out));
        }
    });
}

#[tauri::command]
pub fn e2e_report(state: State<E2eState>, value: String) {
    if let Some(tx) = state.reply.lock().unwrap().take() {
        let _ = tx.send(value);
    }
}
