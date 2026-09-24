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

import type { Gap } from "@/types/domain";
import { stripSecrets as stripGapSecrets } from "./gapfile";

export const BACKUP_MAGIC = "forge.backup/v1";

const SETTINGS_KEY = "forge.settings";
const GAPS_KEY = "forge.gaps";
/** Fields that must never leave the device inside a backup file. */
const SECRET_FIELDS = ["apiKey", "ccToken"] as const;

const isForgeKey = (k: string) => k.startsWith("forge.");

/**
 * Remove credentials from a persisted blob: the API key and CLI token in
 * settings, and bot tokens, webhooks, paired owners and connector tokens in
 * the packs — a bot token in a backup file is remote control of this Mac.
 */
function stripSecrets(key: string, value: string): string {
  if (key !== SETTINGS_KEY && key !== GAPS_KEY) return value;
  try {
    const parsed = JSON.parse(value);
    if (key === SETTINGS_KEY && parsed?.state) for (const f of SECRET_FIELDS) delete parsed.state[f];
    if (key === GAPS_KEY && Array.isArray(parsed?.state?.gaps)) {
      parsed.state.gaps = parsed.state.gaps.map((g: Gap) => ({ ...stripGapSecrets(g), env: g.env, mcpServers: g.mcpServers }));
    }
    return JSON.stringify(parsed);
  } catch {
    // Unparseable blob: drop it rather than risk exporting a credential.
    return "";
  }
}

type ChannelSecrets = Pick<import("@/types/domain").Channel, "token" | "config" | "owners" | "remoteControl">;

/** This device's channel and connector secrets, by agent and entry id. */
function deviceSecrets(store: Storage): Map<string, ChannelSecrets | string[] | undefined> {
  const out = new Map<string, ChannelSecrets | string[] | undefined>();
  try {
    const gaps: Gap[] = JSON.parse(store.getItem(GAPS_KEY) ?? "null")?.state?.gaps ?? [];
    for (const g of gaps)
      for (const a of g.agents) {
        for (const c of a.channels) out.set(`${a.id}/ch/${c.id}`, { token: c.token, config: c.config, owners: c.owners, remoteControl: c.remoteControl });
        for (const c of a.connectors) if (c.scopes) out.set(`${a.id}/co/${c.id}`, c.scopes);
      }
  } catch {
    // Nothing worth keeping from a corrupt blob.
  }
  return out;
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
  const secrets = deviceSecrets(store);
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

  // Put this device's bot and connector credentials back on matching entries.
  if (secrets.size > 0) {
    try {
      const parsed = JSON.parse(store.getItem(GAPS_KEY) ?? "null");
      for (const g of parsed?.state?.gaps ?? [])
        for (const a of g.agents ?? []) {
          a.channels = (a.channels ?? []).map((c: any) => ({ ...c, ...(secrets.get(`${a.id}/ch/${c.id}`) as object) }));
          a.connectors = (a.connectors ?? []).map((c: any) => {
            const scopes = secrets.get(`${a.id}/co/${c.id}`);
            return scopes ? { ...c, scopes, status: "connected" } : c;
          });
        }
      if (parsed) store.setItem(GAPS_KEY, JSON.stringify(parsed));
    } catch {
      // Unreadable restored blob: leave it.
    }
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
