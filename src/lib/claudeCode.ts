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
    return "Claude Code isn't signed in on this machine. Run `claude` in a terminal and sign in, then add a background-run token in Settings → Runtime.";
  }
  if (/401|invalid authentication|failed to authenticate|token has expired/i.test(raw)) {
    // Being signed in interactively is NOT enough: that token is short-lived and
    // a headless `claude -p` run cannot refresh it, so it 401s while the
    // terminal still works. `claude setup-token` mints a long-lived one.
    return "Claude Code is signed in, but its terminal session token is short-lived and background runs can't refresh it. Either sign in again with `claude auth login` (works until it next expires), or run `claude setup-token` for a permanent fix and paste it into Settings → Runtime. Both use your subscription — no API key, nothing metered.";
  }
  return raw;
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
