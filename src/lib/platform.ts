/**
 * Platform helpers. Forge runs as a native Tauri app and as a plain web build
 * (handy for development and verification). Native-only capabilities check
 * `isDesktop()` before reaching for Tauri APIs.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function platformName(): "desktop" | "web" {
  return isDesktop() ? "desktop" : "web";
}

/** Invoke a Tauri command; throws a friendly error on web. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) {
    throw new Error(`"${cmd}" needs the desktop app (native runtime not available in the web build).`);
  }
  return tauriInvoke<T>(cmd, args);
}

/**
 * Open a link in the user's browser. Inside the desktop app a plain link
 * would navigate Forge's own window away, so it goes through the opener
 * plugin; only http(s) and mailto are allowed (capabilities/default.json).
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
