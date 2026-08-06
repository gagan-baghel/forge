//! Credential storage backed by the OS keychain (macOS Keychain, Windows
//! Credential Manager, Linux Secret Service).
//!
//! The Claude API key and Claude Code OAuth token are long-lived credentials
//! that bill real money. localStorage in the webview is plaintext on disk and
//! readable by anything running as the user, so keys live here instead and
//! never touch the persisted store.

const SERVICE: &str = "dev.forge.app";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("keychain unavailable: {e}"))
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    let e = entry(&key)?;
    if value.is_empty() {
        // Empty means "cleared"; drop the entry instead of storing a blank.
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("could not clear secret: {err}")),
        };
    }
    e.set_password(&value)
        .map_err(|err| format!("could not save secret: {err}"))
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("could not read secret: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip against the real keychain. Uses a throwaway key so it can
    /// never clobber a developer's actual stored credentials.
    #[test]
    fn stores_reads_and_clears_a_secret() {
        let key = "forge-test-scratch";

        // Headless CI has no Secret Service; there is nothing to assert there.
        if secret_set(key.into(), "hunter2".into()).is_err() {
            eprintln!("no keychain backend available — skipping");
            return;
        }
        assert_eq!(secret_get(key.into()).expect("get"), Some("hunter2".into()));

        // Overwrite, not append.
        secret_set(key.into(), "hunter3".into()).expect("overwrite");
        assert_eq!(secret_get(key.into()).expect("get"), Some("hunter3".into()));

        // Empty means "clear", and reading a missing key is None, not an error.
        secret_set(key.into(), String::new()).expect("clear");
        assert_eq!(secret_get(key.into()).expect("get missing"), None);

        // Clearing an already-absent entry is a no-op, not a failure.
        secret_set(key.into(), String::new()).expect("idempotent clear");
    }
}
