/**
 * Backup marshalling for Settings → Data & backup.
 *
 * Split out from the view so the one rule that matters can be tested: an
 * exported file must never contain credentials, and restoring one must not
 * clobber the credentials already on the device.
 *
 * Credentials live inside the settings blob, so stripping them means reaching
 * into that one entry rather than skipping a whole key.
 */

export const BACKUP_MAGIC = "forge.backup/v1";

const SETTINGS_KEY = "forge.settings";
/** Fields that must never leave the device inside a backup file. */
const SECRET_FIELDS = ["apiKey", "ccToken"] as const;

const isForgeKey = (k: string) => k.startsWith("forge.");

/** Remove credential fields from a persisted settings blob, if it is one. */
function stripSecrets(key: string, value: string): string {
  if (key !== SETTINGS_KEY) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.state) for (const f of SECRET_FIELDS) delete parsed.state[f];
    return JSON.stringify(parsed);
  } catch {
    // Unparseable settings blob: drop it rather than risk exporting a key.
    return "";
  }
}

/** Every persisted Forge key, with credentials stripped out of the settings blob. */
export function collectBackup(store: Storage = localStorage): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)!;
    if (!isForgeKey(key)) continue;
    const value = store.getItem(key);
    if (value === null) continue;
    const safe = stripSecrets(key, value);
    if (safe) data[key] = safe;
  }
  return data;
}

/**
 * Replace Forge data with a backup's contents. The credentials already on this
 * device are preserved: a backup file carries none, so restoring one blindly
 * would log the user out of their own API key every time.
 */
export function applyBackup(data: Record<string, string>, store: Storage = localStorage): void {
  const current = store.getItem(SETTINGS_KEY);
  const keep: Record<string, string> = {};
  if (current) {
    try {
      const state = JSON.parse(current)?.state ?? {};
      for (const f of SECRET_FIELDS) if (state[f]) keep[f] = state[f];
    } catch {
      // Nothing worth keeping from a corrupt blob.
    }
  }

  for (const key of Object.keys(store)) {
    if (isForgeKey(key)) store.removeItem(key);
  }

  for (const [k, v] of Object.entries(data)) {
    // Defence in depth: a hand-edited file must not inject credentials either.
    store.setItem(k, stripSecrets(k, v) || v);
  }

  // Put this device's own credentials back on top of the restored settings.
  if (Object.keys(keep).length > 0) {
    const raw = store.getItem(SETTINGS_KEY);
    try {
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = { ...(parsed.state ?? {}), ...keep };
      store.setItem(SETTINGS_KEY, JSON.stringify(parsed));
    } catch {
      // If the restored blob is unreadable, leave it; the user can re-enter.
    }
  }
}
