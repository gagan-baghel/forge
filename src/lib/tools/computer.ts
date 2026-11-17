/**
 * `computer` skill: tools that change the user's machine or drive its screen.
 * Each asks first, every single call: `approve()` denies outright when no
 * dialog is mounted, so a scheduled routine or an inbound channel message can
 * never act on an unattended computer. Scrolling alone is harmless enough to
 * go unasked.
 */
import { isDesktop } from "../platform";
import { errorMessage } from "../runError";
import type { ChannelRef } from "../approval";
import { ask, native, plural, refusal, str } from "./shared";
import type { ClientTool } from "./types";

const DESKTOP_ONLY = "Error: desktop control is only available in the desktop app.";
const TYPE_PREVIEW_CHARS = 400;
const DEFAULT_SCROLL_LINES = 5;

export const shellTool: ClientTool = {
  def: {
    name: "run_shell",
    description:
      "Run a shell command on the user's machine and return its stdout, stderr and exit code. " +
      "Desktop only. The user must approve every call, so state plainly what the command does. " +
      "Prefer one focused command over a long chain.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        cwd: { type: "string", description: "Absolute directory to run in. Defaults to the home directory." },
        purpose: { type: "string", description: "One short line on why, shown to the user in the approval prompt" },
      },
      required: ["command"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return "Error: run_shell is only available in the desktop app.";
    const command = str(input.command);
    if (!command) return "Error: no command given.";
    const cwd = input.cwd ? String(input.cwd) : undefined;
    const purpose = input.purpose ? `${String(input.purpose)}\n\n` : "";

    const ok = await ask(ctx, "Run a command on your computer?", `${purpose}${command}${cwd ? `\n\nin ${cwd}` : ""}`);
    if (ok !== "ok") return refusal(ok, "command");

    const { invoke } = await import("@tauri-apps/api/core");
    const id = `sh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cancel = () => void invoke("shell_cancel", { id })?.catch?.(() => {});
    ctx.signal?.addEventListener("abort", cancel);
    try {
      const r = await invoke<{ stdout: string; stderr: string; code: number }>("shell_exec", { command, cwd, id });
      if (ctx.signal?.aborted) return "Stopped by the user before the command finished.";
      const parts = [`exit code: ${r.code}`];
      if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout}`);
      if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr}`);
      return parts.join("\n\n");
    } catch (e) {
      return `Error running command: ${errorMessage(e)}`;
    } finally {
      ctx.signal?.removeEventListener("abort", cancel);
    }
  },
};

export const writeFileTool: ClientTool = {
  def: {
    name: "write_file",
    description:
      "Write a UTF-8 text file to an absolute path on the user's machine, replacing it if it exists. " +
      "Desktop only, scoped to the home directory. The user must approve every write.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path to write" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return "Error: write_file is only available in the desktop app.";
    const path = str(input.path);
    const content = String(input.content ?? "");
    if (!path) return "Error: no path given.";

    const ok = await ask(
      ctx,
      "Write a file on your computer?",
      `${path}\n\n${plural(content.length, "character")}. Any existing file at this path is replaced.`,
    );
    if (ok !== "ok") return refusal(ok, "write");

    try {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, content);
      return `Wrote ${content.length} characters to ${path}.`;
    } catch (e) {
      return `Error writing file: ${errorMessage(e)}`;
    }
  },
};

export const sendFileTool: ClientTool = {
  def: {
    name: "send_file",
    description:
      "Send a file from the user's machine as a real attachment (any file type, not just text) " +
      "to whichever channel this conversation is on — Discord or Telegram. Only works when the " +
      "conversation arrived through a connected channel; say so if it didn't, don't fall back to " +
      "read_file. Desktop only, 20MB cap. The user must approve every send.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path to send" } },
      required: ["path"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return "Error: send_file is only available in the desktop app.";
    if (!ctx.channel) {
      return (
        "Error: this conversation isn't connected to a channel, so there's nowhere to send " +
        "the file. Tell the user to ask from Discord or Telegram instead."
      );
    }
    const path = str(input.path);
    if (!path) return "Error: no path given.";

    const ok = await ask(ctx, "Send a file from your computer?", `${path}\n\nto ${ctx.channel.kind}`);
    if (ok !== "ok") return refusal(ok, "send");

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { token, chatId, kind } = ctx.channel;
      if (kind === "discord") {
        await invoke("discord_send_file", { token, channelId: chatId, path });
      } else {
        await invoke("telegram_send_file", { token, chatId, path });
      }
      return `Sent ${path} to ${kind}.`;
    } catch (e) {
      return `Error sending file: ${errorMessage(e)}`;
    }
  },
};

/** Post an image to a channel conversation (a photo on Telegram, an attachment on Discord). */
export async function sendImageToChannel(channel: ChannelRef, path: string, caption: string): Promise<void> {
  if (channel.kind === "telegram") {
    await native("telegram_send_photo", { token: channel.token, chatId: channel.chatId, path, caption });
  } else {
    await native("discord_send_file", { token: channel.token, channelId: channel.chatId, path });
  }
}

export const screenshotTool: ClientTool = {
  def: {
    name: "screenshot",
    description:
      "Capture the user's screen and look at it. Use it to see what is open before clicking or typing, " +
      "and again afterwards to check the result. Click/scroll coordinates are in this image's pixels. " +
      "Set send_to_user when the user asked to see their screen (it is then also sent to their chat).",
    input_schema: {
      type: "object",
      properties: {
        send_to_user: { type: "boolean", description: "Also send the image to the user's chat", default: false },
      },
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return DESKTOP_ONLY;
    const channel = input.send_to_user ? ctx.channel : undefined;
    const ok = await ask(
      ctx,
      "Show the agent your screen?",
      channel
        ? `A screenshot is taken and also sent to your ${channel.kind} chat.`
        : "A screenshot is taken so the agent can see it.",
    );
    if (ok !== "ok") return refusal(ok, "screenshot");
    try {
      const shot = await native<{ path: string; base64: string; width: number; height: number }>("screen_capture");
      if (channel) await sendImageToChannel(channel, shot.path, "Your screen");
      return {
        text: `Screenshot ${shot.width}×${shot.height}px${channel ? ", also sent to the user" : ""}. Coordinates for click and scroll are in these pixels.`,
        images: [{ data: shot.base64, mediaType: "image/jpeg" }],
      };
    } catch (e) {
      return `Error taking screenshot: ${errorMessage(e)}`;
    }
  },
};

export const clickTool: ClientTool = {
  def: {
    name: "click",
    description: "Click on the screen at a point from the latest screenshot. Take a screenshot first.",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "number", description: "X in screenshot pixels" },
        y: { type: "number", description: "Y in screenshot pixels" },
        button: { type: "string", enum: ["left", "right"], default: "left" },
        double: { type: "boolean", description: "Double-click", default: false },
        target: { type: "string", description: "What is being clicked, shown to the user" },
      },
      required: ["x", "y"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return DESKTOP_ONLY;
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "Error: x and y must be numbers.";
    const what = input.target ? `${String(input.target)}\n\n` : "";
    const ok = await ask(
      ctx,
      "Click on your screen?",
      `${what}${input.double ? "Double-click" : "Click"} at (${Math.round(x)}, ${Math.round(y)})`,
    );
    if (ok !== "ok") return refusal(ok, "click");
    try {
      await native("input_click", {
        x,
        y,
        button: input.button === "right" ? "right" : "left",
        clicks: input.double ? 2 : 1,
      });
      return "Clicked. Take a screenshot to check the result.";
    } catch (e) {
      return `Error clicking: ${errorMessage(e)}`;
    }
  },
};

export const typeTool: ClientTool = {
  def: {
    name: "type_text",
    description: "Type text into whatever currently has keyboard focus on the user's screen.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to type" } },
      required: ["text"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return DESKTOP_ONLY;
    const text = String(input.text ?? "");
    if (!text) return "Error: no text given.";
    const preview = text.length > TYPE_PREVIEW_CHARS ? `${text.slice(0, TYPE_PREVIEW_CHARS)}…` : text;
    const ok = await ask(ctx, "Type on your computer?", preview);
    if (ok !== "ok") return refusal(ok, "typing");
    try {
      await native("input_type", { text });
      return `Typed ${plural(text.length, "character")}.`;
    } catch (e) {
      return `Error typing: ${errorMessage(e)}`;
    }
  },
};

export const keyTool: ClientTool = {
  def: {
    name: "press_key",
    description:
      "Press a key or shortcut on the user's computer, e.g. 'enter', 'escape', 'tab', 'cmd+space', " +
      "'cmd+shift+t', 'down'. Modifiers: cmd, shift, alt, ctrl.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key or shortcut, '+'-separated, e.g. 'escape' or 'cmd+space'" },
      },
      required: ["key"],
    },
  },
  run: async (input, ctx) => {
    if (!isDesktop()) return DESKTOP_ONLY;
    // Models guess the field name; take whichever they sent.
    const raw = input.key ?? input.keys ?? input.combo ?? input.shortcut ?? "";
    const keys = (Array.isArray(raw) ? raw.join("+") : String(raw)).trim();
    if (!keys) return "Error: no keys given.";
    const ok = await ask(ctx, "Press keys on your computer?", keys);
    if (ok !== "ok") return refusal(ok, "key press");
    try {
      await native("input_key", { combo: keys });
      return `Pressed ${keys}.`;
    } catch (e) {
      return `Error pressing ${keys}: ${errorMessage(e)}`;
    }
  },
};

export const scrollTool: ClientTool = {
  def: {
    name: "scroll",
    description: "Scroll at a point from the latest screenshot. Positive amount scrolls down, negative up (in lines).",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        amount: { type: "number", description: "Lines; positive = down", default: DEFAULT_SCROLL_LINES },
      },
      required: ["x", "y"],
    },
  },
  run: async (input) => {
    if (!isDesktop()) return DESKTOP_ONLY;
    try {
      await native("input_scroll", {
        x: Number(input.x),
        y: Number(input.y),
        amount: Math.round(Number(input.amount ?? DEFAULT_SCROLL_LINES)),
      });
      return "Scrolled.";
    } catch (e) {
      return `Error scrolling: ${errorMessage(e)}`;
    }
  },
};

export const computerTools = [
  shellTool,
  writeFileTool,
  sendFileTool,
  screenshotTool,
  clickTool,
  typeTool,
  keyTool,
  scrollTool,
];
