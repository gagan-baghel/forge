//! Attachments: capped reads for uploads, multipart bodies, and the inbox
//! inbound files are fetched into.

use super::*;

/// Cap on a file the `send_file` tool will upload. Keeps one IPC round-trip
/// and one HTTP request bounded; well under Discord's (8-25MB) and Telegram's
/// (50MB) own limits either way.
pub(super) const MAX_SEND_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Cap on an inbound attachment we download from a paired owner.
const MAX_FETCH_FILE_BYTES: u64 = 50 * 1024 * 1024;

pub(super) fn read_file_capped(path: &str) -> Result<(Vec<u8>, String), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("can't read {path}: {e}"))?;
    if meta.len() > MAX_SEND_FILE_BYTES {
        return Err(format!(
            "{path} is {} MB, over the 20 MB send limit.",
            meta.len() / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("can't read {path}: {e}"))?;
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    Ok((bytes, name))
}

/// Build a `multipart/form-data` body by hand — neither provider's upload
/// endpoint is JSON, and ureq has no multipart helper of its own.
pub(super) fn build_multipart(
    fields: &[(&str, &str)],
    file_field: &str,
    filename: &str,
    file_bytes: &[u8],
) -> (Vec<u8>, String) {
    let boundary = format!(
        "----forge-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n\
             Content-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (body, format!("multipart/form-data; boundary={boundary}"))
}

/// A provider-supplied file name reduced to a safe leaf: no directories, no
/// dot-files, nothing that could climb out of the inbox folder.
fn safe_file_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = leaf
        .chars()
        .filter(|c| !c.is_control() && *c != ':')
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// Where inbound attachments land: `~/Downloads/Forge`.
fn inbox_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("no home directory")?;
    let dir = std::path::PathBuf::from(home).join("Downloads").join("Forge");
    std::fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// First free `name`, `name (1)`, … in `dir` — never overwrite a file.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Download an inbound attachment into `~/Downloads/Forge` and return its path.
/// Called by the frontend only after the sender has been authorised.
#[tauri::command]
pub async fn channel_fetch_file(kind: String, token: String, file_ref: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq_agent();
        let url = if kind == "telegram" {
            let resp = agent
                .get(&format!("{}/bot{token}/getFile", telegram_api()))
                .query("file_id", &file_ref)
                .call()
                .map_err(|e| redact(e, &token))?;
            let json: serde_json::Value =
                serde_json::from_str(&resp.into_string().unwrap_or_default()).unwrap_or_default();
            let path = json["result"]["file_path"]
                .as_str()
                .ok_or("Telegram didn't return the file.")?;
            format!("{}/file/bot{token}/{path}", telegram_api())
        } else {
            // Debug builds may point at a fake Discord (see api_root) — its
            // attachments are served from the same fake.
            let test_cdn =
                cfg!(debug_assertions) && std::env::var("FORGE_DISCORD_API").is_ok_and(|a| file_ref.starts_with(&a));
            if !test_cdn
                && !file_ref.starts_with("https://cdn.discordapp.com/")
                && !file_ref.starts_with("https://media.discordapp.net/")
            {
                return Err("Refusing to fetch a Discord attachment from an unexpected host.".into());
            }
            file_ref.clone()
        };

        let resp = agent.get(&url).call().map_err(|e| redact(e, &token))?;
        let mut bytes = Vec::new();
        use std::io::Read;
        resp.into_reader()
            .take(MAX_FETCH_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FETCH_FILE_BYTES {
            return Err("Attachment is over the 50 MB limit.".into());
        }
        let path = unique_path(&inbox_dir()?, &safe_file_name(&name));
        std::fs::write(&path, bytes).map_err(|e| format!("can't save {}: {e}", path.display()))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multipart_body_carries_fields_and_file_bytes_intact() {
        let (body, content_type) = build_multipart(&[("chat_id", "42")], "document", "notes.txt", b"hi there");
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"chat_id\""));
        assert!(text.contains("42"));
        assert!(text.contains("filename=\"notes.txt\""));
        assert!(text.contains("hi there"));
    }

    #[test]
    fn read_file_capped_rejects_a_file_over_the_size_limit() {
        let path = std::env::temp_dir().join("forge_send_file_cap_test.bin");
        std::fs::write(&path, vec![0u8; (MAX_SEND_FILE_BYTES + 1) as usize]).unwrap();
        let err = read_file_capped(path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("20 MB"), "got {err:?}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_file_capped_reads_a_small_file() {
        let path = std::env::temp_dir().join("forge_send_file_small_test.txt");
        std::fs::write(&path, b"hello").unwrap();
        let (bytes, name) = read_file_capped(path.to_str().unwrap()).unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(name, "forge_send_file_small_test.txt");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn inbound_file_names_cannot_escape_the_inbox() {
        assert_eq!(safe_file_name("../../.ssh/authorized_keys"), "authorized_keys");
        assert_eq!(safe_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name(""), "file");
        assert_eq!(safe_file_name("report.pdf"), "report.pdf");
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join("forge_unique_path_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.txt"), dir.join("a (1).txt"));
        assert_eq!(unique_path(&dir, "b.txt"), dir.join("b.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
