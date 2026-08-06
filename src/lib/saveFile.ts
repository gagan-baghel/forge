/**
 * Save text to a user-chosen file.
 *
 * The desktop webview does not act on `<a download>` the way a browser does,
 * so on desktop this opens a native save dialog and writes through the Tauri
 * fs plugin. The anchor path remains for the web build.
 */

import { isDesktop } from "./platform";

export interface SaveResult {
  /** False when the user dismissed the save dialog. */
  saved: boolean;
  path?: string;
}

export async function saveTextFile(
  suggestedName: string,
  contents: string,
  filter?: { name: string; extensions: string[] },
): Promise<SaveResult> {
  if (!isDesktop()) {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return { saved: true };
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: suggestedName,
    filters: filter ? [filter] : undefined,
  });
  if (!path) return { saved: false };

  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, contents);
  return { saved: true, path };
}
