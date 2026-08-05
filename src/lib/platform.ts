/**
 * Platform helpers. Forge runs as a native Tauri app and as a plain web build
 * (handy for development and verification). Native-only capabilities check
 * `isDesktop()` before reaching for Tauri APIs.
 */

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function platformName(): "desktop" | "web" {
  return isDesktop() ? "desktop" : "web";
}

/** Lazily invoke a Tauri command; throws a friendly error on web. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) {
    throw new Error(`"${cmd}" needs the desktop app (native runtime not available in the web build).`);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
