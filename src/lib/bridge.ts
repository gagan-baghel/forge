/**
 * Frontend half of the Forge tool bridge (see `src-tauri/src/bridge.rs`).
 *
 * The Rust side serves an MCP endpoint per Claude Code run and forwards each
 * `tools/call` here as a `bridge://call` event. This module runs the call with
 * the executor and context the run registered, and answers with
 * `bridge_respond`. `permission_prompt` is the CLI asking whether it may use
 * one of its own tools (Bash, Write…) — that goes through `approve()` like any
 * Forge tool, so the in-app dialog or the owner's phone decides.
 */

import { invoke, isDesktop } from "./platform";
import { approve } from "./approval";
import { runTool, type ToolContext, type ToolOutput } from "./tools";
import type { ToolEvent } from "./agentRun";

export const PERMISSION_TOOL = "permission_prompt";

type Executors = Parameters<typeof runTool>[2];

export interface BridgeRun {
  executors: Executors;
  ctx: ToolContext;
  onTool?: (event: ToolEvent) => void;
}

interface BridgeCall {
  call_id: number;
  run_id: string;
  name: string;
  args: any;
}

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const runs = new Map<string, BridgeRun>();
let listening: Promise<void> | null = null;

export function registerBridgeRun(runId: string, run: BridgeRun): void {
  runs.set(runId, run);
}

export function unregisterBridgeRun(runId: string): void {
  runs.delete(runId);
}

function toMcp(out: ToolOutput): McpContent[] {
  if (typeof out === "string") return [{ type: "text", text: out }];
  return [
    { type: "text", text: out.text },
    ...out.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mediaType })),
  ];
}

/** The permission-prompt answer shape Claude Code expects, as JSON text. */
function decision(allow: boolean, input: unknown, message: string): McpContent[] {
  const body = allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message };
  return [{ type: "text", text: JSON.stringify(body) }];
}

/** How a CLI tool request reads in an approval prompt. */
export function describeCliTool(toolName: string, input: any): { title: string; body: string } {
  const i = input ?? {};
  switch (toolName) {
    case "Bash":
      return {
        title: "Run a command on your computer?",
        body: [i.description, i.command].filter(Boolean).join("\n\n"),
      };
    case "Write":
      return {
        title: "Write a file on your computer?",
        body: `${i.file_path ?? ""}\n\n${String(i.content ?? "").length} characters. Any existing file is replaced.`,
      };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { title: "Edit a file on your computer?", body: String(i.file_path ?? i.notebook_path ?? "") };
    case "Read":
      return { title: "Read a file on your computer?", body: String(i.file_path ?? "") };
    case "WebFetch":
      return { title: "Fetch a web page?", body: String(i.url ?? "") };
    default:
      return { title: `Allow ${toolName}?`, body: JSON.stringify(i, null, 2).slice(0, 800) };
  }
}

export async function handleBridgeCall(call: BridgeCall): Promise<{ content: McpContent[]; isError: boolean }> {
  const run = runs.get(call.run_id);
  if (!run) return { content: [{ type: "text", text: "This run has finished." }], isError: true };

  if (call.name === PERMISSION_TOOL) {
    const toolName = String(call.args?.tool_name ?? "");
    const input = call.args?.input ?? {};
    const { title, body } = describeCliTool(toolName, input);
    // Provenance is marked when a tool's *output* arrives (see agentRun's CLI
    // branch), not here: approving `printf x > file` reads nothing.
    const result = await approve({ title, body, turn: run.ctx.turn, channel: run.ctx.channel });
    const message =
      result === "timeout"
        ? "Nobody answered the approval in time, so this did not happen. Say exactly that; do not retry."
        : "The user denied this. Do not retry it; ask what they'd prefer instead.";
    return { content: decision(result === "ok", input, message), isError: false };
  }

  const id = `bridge-${call.call_id}`;
  run.onTool?.({ id, name: call.name, input: call.args, status: "running" });
  const out = await runTool(call.name, call.args ?? {}, run.executors, run.ctx);
  const text = typeof out === "string" ? out : out.text;
  const isError = text.startsWith("Error");
  run.onTool?.({ id, name: call.name, input: call.args, output: text, status: isError ? "error" : "done" });
  return { content: toMcp(out), isError };
}

/** Install the global `bridge://call` handler once. */
export function initBridge(): Promise<void> {
  if (listening || !isDesktop()) return listening ?? Promise.resolve();
  listening = (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<BridgeCall>("bridge://call", async (e) => {
      let reply: { content: McpContent[]; isError: boolean };
      try {
        reply = await handleBridgeCall(e.payload);
      } catch (err: any) {
        reply = { content: [{ type: "text", text: `Error: ${err?.message ?? err}` }], isError: true };
      }
      await invoke("bridge_respond", { callId: e.payload.call_id, content: reply.content, isError: reply.isError }).catch(
        () => {},
      );
    });
  })();
  return listening;
}
