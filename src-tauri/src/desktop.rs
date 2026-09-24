//! Desktop control: see the screen, move the mouse, type, press keys, and keep
//! the Mac awake. These back the agent's desktop tools, which are what let a
//! message from a phone do anything a person at the keyboard could.
//!
//! Every tool that calls in here is gated by an approval on the frontend.
//! macOS only for now: screenshots use `screencapture`/`sips`, input goes
//! through CoreGraphics and System Events via JavaScript for Automation, so no
//! extra binaries ship. Both need the user to grant Forge Screen Recording and
//! Accessibility access once (System Settings → Privacy & Security).

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

#[derive(Default)]
pub struct DesktopState {
    /// Points per screenshot pixel from the last capture. The model clicks in
    /// the coordinates of the image it saw; this maps them back to the screen.
    /// ponytail: main display only, extend when multi-monitor control matters.
    scale: Mutex<f64>,
    caffeinate: Mutex<Option<Child>>,
}

#[derive(Serialize)]
pub struct Screenshot {
    /// Local path of the (downscaled) JPEG.
    pub path: String,
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

/// Longest edge sent to the model. Claude downsamples anything larger anyway,
/// and a smaller image is cheaper and faster to ship to a phone.
const MAX_EDGE: u32 = 1400;

fn macos_only() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err("Desktop control is only available on macOS for now.".into())
    }
}

fn run(cmd: &mut Command) -> Result<String, String> {
    let out = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(explain_permission(&err));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The raw macOS errors for a missing privacy grant are cryptic; say what to do.
fn explain_permission(err: &str) -> String {
    if err.contains("-1743") || err.contains("-25211") || err.contains("not allowed assistive") || err.contains("1002") {
        return "macOS blocked this: give Forge Accessibility access in System Settings → Privacy & Security → \
                Accessibility, then try again."
            .into();
    }
    if err.contains("could not create image") || err.contains("screen") && err.contains("permission") {
        return "macOS blocked the screenshot: give Forge Screen Recording access in System Settings → \
                Privacy & Security → Screen Recording, then restart Forge."
            .into();
    }
    if err.is_empty() {
        "The command failed.".into()
    } else {
        err.into()
    }
}

fn jxa(script: &str, args: &[String]) -> Result<String, String> {
    run(Command::new("osascript").args(["-l", "JavaScript", "-e", script, "--"]).args(args))
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn screen_points_width() -> Result<f64, String> {
    jxa(r#"ObjC.import("AppKit"); function run(){ return $.NSScreen.mainScreen.frame.size.width; }"#, &[])?
        .parse::<f64>()
        .map_err(|e| e.to_string())
}

fn image_size(path: &str) -> Result<(u32, u32), String> {
    let out = run(Command::new("sips").args(["-g", "pixelWidth", "-g", "pixelHeight", path]))?;
    let grab = |key: &str| -> u32 {
        out.lines()
            .find(|l| l.trim_start().starts_with(key))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0)
    };
    Ok((grab("pixelWidth"), grab("pixelHeight")))
}

/// Capture the main display, downscale it, and remember the scale so later
/// clicks land where the model meant.
#[tauri::command]
pub async fn screen_capture(state: State<'_, DesktopState>) -> Result<Screenshot, String> {
    macos_only()?;
    let shot = tauri::async_runtime::spawn_blocking(|| -> Result<(Screenshot, f64), String> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = std::env::temp_dir().join(format!("forge-screen-{stamp}.jpg"));
        let p = path.to_string_lossy().to_string();
        run(Command::new("screencapture").args(["-x", "-m", "-t", "jpg", &p]))?;
        run(Command::new("sips").args([
            "-Z",
            &MAX_EDGE.to_string(),
            "-s",
            "formatOptions",
            "70",
            &p,
            "--out",
            &p,
        ]))?;
        let (width, height) = image_size(&p)?;
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let scale = if width > 0 { screen_points_width()? / width as f64 } else { 1.0 };
        Ok((Screenshot { path: p, base64: b64(&bytes), width, height }, scale))
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.scale.lock().unwrap() = shot.1;
    Ok(shot.0)
}

fn to_points(state: &DesktopState, x: f64, y: f64) -> (f64, f64) {
    let s = *state.scale.lock().unwrap();
    let s = if s > 0.0 { s } else { 1.0 };
    ((x * s).round(), (y * s).round())
}

const CLICK_JXA: &str = r#"
ObjC.import("CoreGraphics");
function run(argv) {
  var p = { x: +argv[0], y: +argv[1] };
  var right = argv[2] === "right";
  var clicks = Math.max(1, +argv[3] || 1);
  var down = right ? $.kCGEventRightMouseDown : $.kCGEventLeftMouseDown;
  var up = right ? $.kCGEventRightMouseUp : $.kCGEventLeftMouseUp;
  var btn = right ? $.kCGMouseButtonRight : $.kCGMouseButtonLeft;
  $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, btn));
  delay(0.05);
  for (var i = 1; i <= clicks; i++) {
    var d = $.CGEventCreateMouseEvent(null, down, p, btn);
    $.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, i);
    $.CGEventPost($.kCGHIDEventTap, d);
    var u = $.CGEventCreateMouseEvent(null, up, p, btn);
    $.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, i);
    $.CGEventPost($.kCGHIDEventTap, u);
  }
  return "ok";
}"#;

/// Click at a point given in the coordinates of the last screenshot.
#[tauri::command]
pub async fn input_click(state: State<'_, DesktopState>, x: f64, y: f64, button: Option<String>, clicks: Option<u32>) -> Result<(), String> {
    macos_only()?;
    let (px, py) = to_points(&state, x, y);
    let args = vec![
        px.to_string(),
        py.to_string(),
        button.unwrap_or_else(|| "left".into()),
        clicks.unwrap_or(1).to_string(),
    ];
    tauri::async_runtime::spawn_blocking(move || jxa(CLICK_JXA, &args).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

const SCROLL_JXA: &str = r#"
ObjC.import("CoreGraphics");
function run(argv) {
  var p = { x: +argv[0], y: +argv[1] };
  $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft));
  var e = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 1, -(+argv[2]));
  $.CGEventPost($.kCGHIDEventTap, e);
  return "ok";
}"#;

/// Scroll at a point; positive `amount` scrolls down, in lines.
#[tauri::command]
pub async fn input_scroll(state: State<'_, DesktopState>, x: f64, y: f64, amount: i32) -> Result<(), String> {
    macos_only()?;
    let (px, py) = to_points(&state, x, y);
    let args = vec![px.to_string(), py.to_string(), amount.clamp(-50, 50).to_string()];
    tauri::async_runtime::spawn_blocking(move || jxa(SCROLL_JXA, &args).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

const TYPE_JXA: &str = r#"
function run(argv) {
  Application("System Events").keystroke(argv[0]);
  return "ok";
}"#;

/// Type text into whatever has focus. The text travels as an argv entry, never
/// spliced into the script, so it cannot break out into code.
#[tauri::command]
pub async fn input_type(text: String) -> Result<(), String> {
    macos_only()?;
    tauri::async_runtime::spawn_blocking(move || jxa(TYPE_JXA, &[text]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// macOS virtual key codes for the named keys an agent needs.
fn key_code(name: &str) -> Option<u32> {
    Some(match name {
        "enter" | "return" => 36,
        "tab" => 48,
        "space" => 49,
        "delete" | "backspace" => 51,
        "escape" | "esc" => 53,
        "forwarddelete" => 117,
        "home" => 115,
        "end" => 119,
        "pageup" => 116,
        "pagedown" => 121,
        "left" => 123,
        "right" => 124,
        "down" => 125,
        "up" => 126,
        "f1" => 122,
        "f2" => 120,
        "f3" => 99,
        "f4" => 118,
        "f5" => 96,
        _ => return None,
    })
}

/// Parse "cmd+shift+t" into (modifiers, key). Unknown modifiers are an error,
/// not silently dropped — a dropped "cmd" turns cmd+q into typing a "q".
pub fn parse_combo(combo: &str) -> Result<(Vec<&'static str>, String), String> {
    let parts: Vec<String> = combo.split('+').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect();
    let Some((key, mods)) = parts.split_last() else {
        return Err("No key given.".into());
    };
    let mut out = Vec::new();
    for m in mods {
        out.push(match m.as_str() {
            "cmd" | "command" | "meta" | "super" => "command down",
            "shift" => "shift down",
            "alt" | "option" | "opt" => "option down",
            "ctrl" | "control" => "control down",
            other => return Err(format!("Unknown modifier \"{other}\".")),
        });
    }
    Ok((out, key.clone()))
}

const KEY_JXA: &str = r#"
function run(argv) {
  var se = Application("System Events");
  var mods = argv.slice(2).filter(function (m) { return m.length > 0; });
  var opts = mods.length ? { using: mods } : {};
  if (argv[0] === "code") se.keyCode(+argv[1], opts);
  else se.keystroke(argv[1], opts);
  return "ok";
}"#;

/// Press a key or shortcut, e.g. "enter", "cmd+space", "cmd+shift+4".
#[tauri::command]
pub async fn input_key(combo: String) -> Result<(), String> {
    macos_only()?;
    let (mods, key) = parse_combo(&combo)?;
    let mut args = match key_code(&key) {
        Some(code) => vec!["code".to_string(), code.to_string()],
        None if key.chars().count() == 1 => vec!["char".to_string(), key],
        None => return Err(format!("Unknown key \"{key}\".")),
    };
    args.extend(mods.into_iter().map(String::from));
    tauri::async_runtime::spawn_blocking(move || jxa(KEY_JXA, &args).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// Keep the Mac from idle-sleeping while remote control is on, so a message
/// sent from a phone an hour later still finds Forge listening. `caffeinate`
/// is tied to Forge's pid, so it can never outlive the app.
#[tauri::command]
pub fn keep_awake(state: State<DesktopState>, on: bool) -> Result<bool, String> {
    let mut slot = state.caffeinate.lock().unwrap();
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if on {
        if !cfg!(target_os = "macos") {
            return Err("Keep-awake is only available on macOS for now.".into());
        }
        let child = Command::new("caffeinate")
            .args(["-i", "-s", "-w", &std::process::id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("couldn't start caffeinate: {e}"))?;
        *slot = Some(child);
    }
    Ok(on)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combos_parse_into_modifiers_and_a_key() {
        assert_eq!(parse_combo("cmd+shift+t").unwrap(), (vec!["command down", "shift down"], "t".to_string()));
        assert_eq!(parse_combo("Enter").unwrap(), (vec![], "enter".to_string()));
        assert!(parse_combo("hyper+t").is_err(), "unknown modifiers must not be dropped");
        assert!(parse_combo("").is_err());
    }

    #[test]
    fn named_keys_have_codes() {
        assert_eq!(key_code("enter"), Some(36));
        assert_eq!(key_code("esc"), Some(53));
        assert_eq!(key_code("q"), None);
    }

    #[test]
    fn clicks_scale_from_screenshot_pixels_to_screen_points() {
        let state = DesktopState::default();
        *state.scale.lock().unwrap() = 1440.0 / 1400.0;
        assert_eq!(to_points(&state, 700.0, 100.0), (720.0, 103.0));
        // No capture yet: pass coordinates through unchanged.
        *state.scale.lock().unwrap() = 0.0;
        assert_eq!(to_points(&state, 10.0, 20.0), (10.0, 20.0));
    }

    #[test]
    fn permission_errors_say_what_to_do() {
        assert!(explain_permission("execution error: not allowed assistive access. (-25211)").contains("Accessibility"));
    }
}
