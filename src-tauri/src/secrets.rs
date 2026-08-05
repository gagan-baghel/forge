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

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("could not delete secret: {err}")),
    }
}
