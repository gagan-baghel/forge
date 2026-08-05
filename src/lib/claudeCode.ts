/**
 * Claude Code runtime client (desktop only).
 *
 * Drives the local `claude` CLI through Tauri commands and listens to the
 * `cc://event` stream the Rust side emits. Mirrors the shape of `streamChat`
 * so the chat hook can switch runtimes transparently. Runs on the user's
 * Claude Code subscription — no API key, no metered cost.
 */

import { nanoid } from "nanoid";
import { invoke, isDesktop } from "./platform";
import { useSettings } from "@/stores/settings";

export interface ClaudeCodeInfo {
  available: boolean;
  version: string;
  path: string;
}

/** Probe whether the Claude Code CLI is installed and runnable. */
export async function detectClaudeCode(): Promise<ClaudeCodeInfo> {
  if (!isDesktop()) return { available: false, version: "", path: "" };
  try {
    return await invoke<ClaudeCodeInfo>("claude_code_detect");
  } catch {
    return { available: false, version: "", path: "" };
  }
}

/** Map raw CLI failures to actionable messages. */
function friendlyCcError(raw: string): string {
  if (/not logged in|please run \/login/i.test(raw)) {
    return "Claude Code isn't signed in on this machine. Open Settings → Connect Claude Code → Sign in (one browser approval), then try again.";
  }
  if (/401|invalid authentication|failed to authenticate/i.test(raw)) {
    // The CLI may be logged in interactively, but its keychain token is
    // short-lived and headless runs can't refresh it. The in-app Sign in
    // mints a long-lived token that works for agent runs.
    return "Claude Code's session has expired for background runs. Open Settings → Connect Claude Code → Sign in (one browser approval) to refresh it, then try again.";
  }
  return raw;
}

/* ------------------------- One-tap sign-in ----------------------------- */

type LoginEvent = { kind: "data"; text: string } | { kind: "exit" };

export interface LoginCallbacks {
  /** Cleaned (ANSI-stripped) chunk of setup-token output. */
  onData: (text: string) => void;
  /** The flow ended without producing a token. */
  onExit: () => void;
}

const stripAnsi = (s: string) =>
  // CSI sequences, OSC sequences, and stray control chars xterm emits.
  s.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

/** Start the in-app sign-in (drives `claude setup-token` in a hidden PTY).
 *  Returns an unlisten/cancel function. */
export async function startCcLogin(cb: LoginCallbacks): Promise<() => void> {
  if (!isDesktop()) throw new Error("Sign-in needs the desktop app.");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LoginEvent>("cc://login", (e) => {
    if (e.payload.kind === "data") cb.onData(stripAnsi(e.payload.text));
    else cb.onExit();
  });
  await invoke("claude_code_login");
  return () => {
    unlisten();
    void invoke("claude_code_login_cancel").catch(() => {});
  };
}

/** Send the pasted OAuth code (or any input) to the sign-in flow. */
export async function ccLoginInput(text: string): Promise<void> {
  await invoke("claude_code_login_input", { data: text });
}

type InstallEvent =
  | { kind: "line"; text: string }
  | { kind: "done"; info: ClaudeCodeInfo; error: string | null };

/**
 * Install the Claude Code CLI from inside the app (desktop only). Streams
 * installer output lines to `onLine`; resolves with the post-install detect
 * result. Rejects only when the install failed AND the CLI is still missing.
 */
export async function installClaudeCode(onLine: (text: string) => void): Promise<ClaudeCodeInfo> {
  if (!isDesktop()) {
    throw new Error("Installing the CLI needs the desktop app.");
  }
  const { listen } = await import("@tauri-apps/api/event");

  return new Promise<ClaudeCodeInfo>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    listen<InstallEvent>("cc://install", (e) => {
      const ev = e.payload;
      if (ev.kind === "line") {
        onLine(ev.text);
      } else {
        unlisten?.();
        if (ev.error && !ev.info.available) reject(new Error(ev.error));
        else resolve(ev.info);
      }
    })
      .then((un) => {
        unlisten = un;
        return invoke("claude_code_install");
      })
      .catch((err) => {
        unlisten?.();
        reject(err);
      });
  });
}

type CcEvent =
  | { kind: "text"; run_id: string; text: string }
  | {
      kind: "done";
      run_id: string;
      session_id: string;
      input_tokens: number;
      output_tokens: number;
      text: string;
      error: string | null;
    };

export interface ClaudeCodeRequest {
  model: string;
  system: string;
  /** The latest user message (CLI keeps prior context via the session). */
  prompt: string;
  /** Existing session id to resume, or "" for a fresh session. */
  resume: string;
  /** Pack MCP servers as `--mcp-config` JSON (see buildMcpConfig). */
  mcpConfig?: string;
  /** Pack environment variables, applied to the CLI process. */
  env?: Record<string, string>;
}

export interface ClaudeCodeCallbacks {
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ClaudeCodeResult {
  text: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
}

/** Run one turn through the CLI, streaming text deltas. */
export async function streamClaudeCode(
  req: ClaudeCodeRequest,
  cb: ClaudeCodeCallbacks,
): Promise<ClaudeCodeResult> {
  if (!isDesktop()) {
    throw new Error("Claude Code runtime needs the desktop app (the CLI runs on your machine).");
  }
  const { listen } = await import("@tauri-apps/api/event");
  const runId = nanoid(10);

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    const cleanup = () => {
      unlisten?.();
      cb.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      void invoke("claude_code_cancel", { runId }).catch(() => {});
      settled = true;
      cleanup();
      reject(Object.assign(new Error("Stopped."), { name: "AbortError" }));
    };

    listen<CcEvent>("cc://event", (e) => {
      const ev = e.payload;
      if (ev.run_id !== runId) return;
      if (ev.kind === "text") {
        cb.onText(ev.text);
      } else if (ev.kind === "done") {
        if (settled) return;
        settled = true;
        cleanup();
        if (ev.error) {
          reject(new Error(friendlyCcError(ev.error)));
        } else {
          resolve({
            text: ev.text,
            sessionId: ev.session_id,
            inputTokens: ev.input_tokens,
            outputTokens: ev.output_tokens,
          });
        }
      }
    })
      .then((un) => {
        unlisten = un;
        if (cb.signal?.aborted) return onAbort();
        cb.signal?.addEventListener("abort", onAbort);
        // The in-app sign-in token (when present) authenticates every run,
        // independent of the CLI's own keychain session.
        const ccToken = useSettings.getState().ccToken;
        const env = {
          ...(req.env ?? {}),
          ...(ccToken ? { CLAUDE_CODE_OAUTH_TOKEN: ccToken } : {}),
        };
        return invoke("claude_code_run", {
          runId,
          model: req.model,
          system: req.system,
          prompt: req.prompt,
          resume: req.resume,
          mcpConfig: req.mcpConfig ?? null,
          env: Object.keys(env).length > 0 ? env : null,
        });
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
  });
}
