/**
 * Credential storage.
 *
 * Desktop keeps the Claude API key and Claude Code token in the OS keychain,
 * never in the persisted settings blob — localStorage is plaintext on disk.
 * The web build has no keychain, so it falls back to localStorage under a
 * separate namespace; that build is for development, not for real keys.
 */

import { isDesktop, invoke } from "./platform";

export type SecretKey = "apiKey" | "ccToken";

const SECRET_KEYS: SecretKey[] = ["apiKey", "ccToken"];

/**
 * localStorage namespace used by the web fallback. Backup/restore must skip it
 * so credentials never travel inside an exported file.
 */
export const WEB_SECRET_PREFIX = "forge.secret.";

const WEB_PREFIX = WEB_SECRET_PREFIX;

export async function getSecret(key: SecretKey): Promise<string> {
  if (!isDesktop()) return localStorage.getItem(WEB_PREFIX + key) ?? "";
  try {
    return (await invoke<string | null>("secret_get", { key })) ?? "";
  } catch (e) {
    // A locked or unavailable keychain must not brick the app; the user can
    // re-enter the key in Settings.
    console.error("[forge] keychain read failed:", e);
    return "";
  }
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  if (!isDesktop()) {
    if (value) localStorage.setItem(WEB_PREFIX + key, value);
    else localStorage.removeItem(WEB_PREFIX + key);
    return;
  }
  try {
    await invoke("secret_set", { key, value });
  } catch (e) {
    console.error("[forge] keychain write failed:", e);
    throw e;
  }
}

/**
 * Drop every stored credential. "Wipe all data" clears localStorage, which on
 * desktop would leave the keychain entries behind — so they're removed here.
 */
export async function clearSecrets(): Promise<void> {
  await Promise.all(SECRET_KEYS.map((k) => setSecret(k, "").catch(() => {})));
}
