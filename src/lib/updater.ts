/**
 * Auto-update against GitHub Releases.
 *
 * Only meaningful in a signed release build: the updater plugin verifies the
 * release signature against the pubkey baked into tauri.release.conf.json, and
 * refuses anything it can't verify. In dev, on web, or in a local unsigned
 * build there is no updater config, so every call here is a no-op.
 */

import { isDesktop } from "./platform";

export interface UpdateInfo {
  version: string;
  notes: string;
}

/**
 * Returns the pending update, or null when up to date / not applicable.
 * Never throws: a missing endpoint or an offline machine must not surface as
 * an error in the UI.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return { version: update.version, notes: update.body ?? "" };
  } catch (e) {
    console.warn("[forge] update check skipped:", e);
    return null;
  }
}

/**
 * Download, install and relaunch. Progress is reported through `onProgress`
 * as a 0–1 fraction when the server sends a content length.
 */
export async function installUpdate(onProgress?: (fraction: number) => void): Promise<void> {
  if (!isDesktop()) throw new Error("Updates are only available in the desktop app.");

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("No update available.");

  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      if (total > 0) onProgress?.(Math.min(received / total, 1));
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
