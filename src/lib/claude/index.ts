/**
 * Direct Claude API client (BYOK). Forge is local-first: chat calls go straight
 * from the app to the Anthropic API using the key the user stores in Settings.
 * No Forge-hosted backend sits in between.
 *
 *  - transport.ts — fetch, deadlines, retries, SSE decoding
 *  - types.ts     — request/response shapes
 *  - this file    — building request bodies and folding streamed events
 */
import { modelSpec } from "@/types/domain";
import type { ChatMessage, ModelId } from "@/types/domain";
import { DEFAULT_EFFORT, supportsAdaptiveThinking, supportsSampling } from "../aiConfig";
import { postStream, sseEvents } from "./transport";
import type {
  ApiContent,
  ChatRequest,
  MessageRequest,
  MessageResult,
  SseEvent,
  StreamCallbacks,
  ToolUse,
} from "./types";

export * from "./types";
export { TimeoutError } from "./transport";

/**
 * Cost of a call, USD. Prices come from the model registry; an override lets
 * the user correct a rate we have stale. An unknown model prices at zero
 * rather than guessing — a wrong number is worse than an obvious blank.
 */
export function costFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
  overrides?: Record<string, { in: number; out: number }>,
): number {
  const price = overrides?.[model] ?? modelSpec(model)?.price ?? { in: 0, out: 0 };
  return (inputTokens * price.in + outputTokens * price.out) / 1_000_000;
}

/** Fields every streamed request shares, whatever the caller. */
function baseBody(req: { model: ModelId; system: string; maxTokens: number; temperature: number }) {
  return {
    model: req.model,
    // Cache the system prompt: it is identical on every turn of a
    // conversation, so without a breakpoint the full prompt is re-billed
    // each time. Prefixes under ~1024 tokens simply don't cache — no error,
    // no cost, so this is safe to always send.
    system: req.system ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] : undefined,
    max_tokens: req.maxTokens,
    // 4.7+ models 400 on any explicit temperature; omit rather than send it.
    temperature: supportsSampling(req.model) ? req.temperature : undefined,
    // Adaptive thinking replaces the removed budget_tokens; effort is the
    // cost/quality dial. Both are 4.7+ only, so older models send neither.
    thinking: supportsAdaptiveThinking(req.model) ? { type: "adaptive" } : undefined,
    stream: true,
  };
}

/**
 * effort and format share one object; sending two output_config keys would
 * drop one silently.
 */
function outputConfig(model: ModelId, extra?: Record<string, unknown>) {
  const adaptive = supportsAdaptiveThinking(model);
  if (!adaptive && !extra) return undefined;
  return { ...(adaptive ? { effort: DEFAULT_EFFORT } : {}), ...(extra ?? {}) };
}

/** A content block as streamed, plus our scratch field for partial tool JSON. */
type StreamBlock = Record<string, unknown> & {
  text?: string;
  citations?: unknown[];
  thinking?: string;
  _partialJson?: string;
};

/** Fold one content_block_delta into its block. Returns the text it added. */
function applyDelta(blk: StreamBlock, d: NonNullable<SseEvent["delta"]>): string {
  switch (d.type) {
    case "text_delta":
      blk.text = (blk.text ?? "") + (d.text ?? "");
      return d.text ?? "";
    case "citations_delta":
      (blk.citations ??= []).push(d.citation);
      break;
    case "thinking_delta":
      blk.thinking = (blk.thinking ?? "") + (d.thinking ?? "");
      break;
    case "signature_delta":
      blk.signature = d.signature;
      break;
    case "input_json_delta":
      blk._partialJson = (blk._partialJson ?? "") + (d.partial_json ?? "");
      break;
  }
  return "";
}

/** Tool inputs arrive as JSON fragments; parse them once the block closes. */
function finishBlock(blk: StreamBlock) {
  if (!("_partialJson" in blk)) return;
  try {
    blk.input = blk._partialJson ? JSON.parse(blk._partialJson) : {};
  } catch {
    blk.input = {};
  }
  delete blk._partialJson;
}

/**
 * One streamed turn of the Messages API, with tool-use support. Text deltas go
 * to `onText`; tool_use blocks are accumulated and returned so the caller can
 * run an agentic loop (execute tools → feed results back → call again).
 */
export async function streamMessage(req: MessageRequest, cb: StreamCallbacks): Promise<MessageResult> {
  const res = await postStream(
    {
      ...baseBody(req),
      output_config: outputConfig(req.model),
      tools: req.tools?.length ? req.tools : undefined,
      container: req.container,
      messages: req.messages,
    },
    req.apiKey,
    cb.signal,
  );

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let container: string | undefined;

  // Every block is kept exactly as streamed, by index, so the turn can be sent
  // back verbatim. Only `_partialJson` is ours, and it is removed on stop.
  const blocks: Record<number, StreamBlock> = {};

  for await (const json of sseEvents(res.body!)) {
    const index = json.index ?? -1;
    switch (json.type) {
      case "message_start":
        inputTokens = json.message?.usage?.input_tokens ?? inputTokens;
        container = json.message?.container?.id ?? container;
        break;
      case "content_block_start": {
        const b = json.content_block;
        if (!b?.type) break;
        const blk: StreamBlock = { ...b };
        // The start event's `{}` input is a placeholder for the streamed JSON.
        if (b.type === "tool_use" || b.type === "server_tool_use") blk._partialJson = "";
        blocks[index] = blk;
        break;
      }
      case "content_block_delta": {
        const blk = blocks[index];
        if (!blk || !json.delta) break;
        const added = applyDelta(blk, json.delta);
        if (added) {
          text += added;
          cb.onText(added);
        }
        break;
      }
      case "content_block_stop":
        if (blocks[index]) finishBlock(blocks[index]);
        break;
      case "message_delta":
        outputTokens = json.usage?.output_tokens ?? outputTokens;
        stopReason = json.delta?.stop_reason ?? stopReason;
        container = json.delta?.container?.id ?? container;
        break;
    }
  }

  cb.onUsage?.({ inputTokens, outputTokens });

  const content = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => blocks[i] as unknown as ApiContent);

  const toolUses: ToolUse[] = content
    .filter((c): c is Extract<ApiContent, { type: "tool_use" }> => c.type === "tool_use")
    .map((c) => ({ id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown> }));

  return { text, content, toolUses, stopReason, inputTokens, outputTokens, container };
}

function toApiMessages(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role !== "system" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Stream a completion. Resolves with the full text + usage once the stream
 * closes. Calls `onText` with each delta so the UI can render live.
 */
export async function streamChat(
  req: ChatRequest,
  cb: StreamCallbacks,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await postStream(
    {
      ...baseBody(req),
      output_config: outputConfig(req.model, req.outputConfig),
      messages: toApiMessages(req.messages),
    },
    req.apiKey,
    cb.signal,
  );

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const json of sseEvents(res.body!)) {
    switch (json.type) {
      case "message_start":
        inputTokens = json.message?.usage?.input_tokens ?? inputTokens;
        break;
      case "content_block_delta":
        if (json.delta?.type === "text_delta" && json.delta.text) {
          text += json.delta.text;
          cb.onText(json.delta.text);
        }
        break;
      case "message_delta":
        outputTokens = json.usage?.output_tokens ?? outputTokens;
        break;
    }
  }

  cb.onUsage?.({ inputTokens, outputTokens });
  return { text, inputTokens, outputTokens };
}
