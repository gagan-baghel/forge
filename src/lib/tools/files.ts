/** `files` skill: read and list files, scoped by the fs plugin's capabilities. */
import { isDesktop } from "../platform";
import { errorMessage } from "../runError";
import { ask, refusal, str } from "./shared";
import type { ClientTool } from "./types";

const READ_LIMIT = 8000;
const LIST_LIMIT = 500;

export const readFileTool: ClientTool = {
  def: {
    name: "read_file",
    description:
      "Read a UTF-8 text file by absolute path (desktop only). Scoped to the user's home " +
      "directory; credential folders (.ssh, .aws, .gnupg, gcloud) are blocked. The user must " +
      "approve every read.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return "Error: read_file is only available in the desktop app.";
    const path = str(input.path);
    if (!path) return "Error: no path given.";

    const ok = await ask(ctx, "Read a file on your computer?", path);
    if (ok !== "ok") return refusal(ok, "read");

    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(path);
      // Say when the file was cut, or the model treats a partial file as whole.
      return text.length > READ_LIMIT
        ? `${text.slice(0, READ_LIMIT)}\n\n[truncated: showing ${READ_LIMIT} of ${text.length} characters]`
        : text;
    } catch (e) {
      return `Error reading file: ${errorMessage(e)}`;
    }
  },
};

export const listFilesTool: ClientTool = {
  def: {
    name: "list_files",
    description:
      "List the files and folders inside a directory by absolute path (desktop only), so you can find " +
      "a file before reading it. Same scope as read_file: the user's home directory, credential folders " +
      "blocked. The user must approve every listing.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute directory path" } },
      required: ["path"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return "Error: list_files is only available in the desktop app.";
    const path = str(input.path);
    if (!path) return "Error: no path given.";

    const ok = await ask(ctx, "List a folder on your computer?", path);
    if (ok !== "ok") return refusal(ok, "listing");

    try {
      const { readDir } = await import("@tauri-apps/plugin-fs");
      const entries = await readDir(path);
      if (!entries.length) return "(empty folder)";
      const lines = entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).sort((a, b) => a.localeCompare(b));
      const shown = lines.slice(0, LIST_LIMIT);
      return shown.join("\n") + (lines.length > shown.length ? `\n… ${lines.length - shown.length} more` : "");
    } catch (e) {
      return `Error listing folder: ${errorMessage(e)}`;
    }
  },
};

export const fileTools = [readFileTool, listFilesTool];
