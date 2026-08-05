/**
 * Backup marshalling for Settings → Data & backup.
 *
 * Split out from the view so the one rule that matters can be tested: an
 * exported file must never contain credentials, and restoring one must not
 * clobber the credentials already on the device.
 */

import { WEB_SECRET_PREFIX } from "./secrets";

export const BACKUP_MAGIC = "forge.backup/v1";

const isForgeKey = (k: string) => k.startsWith("forge.");
const isSecretKey = (k: string) => k.startsWith(WEB_SECRET_PREFIX);

/** Every persisted Forge key except credentials. */
export function collectBackup(store: Storage = localStorage): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)!;
    if (!isForgeKey(key) || isSecretKey(key)) continue;
    const value = store.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

/**
 * Replace Forge data with a backup's contents. Credential entries are left
 * untouched on both sides — the file has none, so wiping them would just log
 * the user out of their own API key on every restore.
 */
export function applyBackup(data: Record<string, string>, store: Storage = localStorage): void {
  for (const key of Object.keys(store)) {
    if (isForgeKey(key) && !isSecretKey(key)) store.removeItem(key);
  }
  for (const [k, v] of Object.entries(data)) {
    if (isSecretKey(k)) continue; // defence in depth: never restore a leaked key
    store.setItem(k, v);
  }
}
