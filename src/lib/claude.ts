/**
 * Direct Claude API client (BYOK). Forge is local-first: chat calls go straight
 * from the app to the Anthropic API using the key the user stores in Settings.
 * No Forge-hosted backend sits in between.
 *
 * Streaming uses the Messages API SSE format. We parse the event stream
 * incrementally and surface text deltas plus a final usage record.
 */

import { modelSpec } from "@/types/domain";
import type { ChatMessage, ModelId } from "@/types/domain";
import { DEFAULT_EFFORT, supportsAdaptiveThinking, supportsSampling } from "./aiConfig";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

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

/**
 * Timeouts. Without these a hung connection or a stalled stream pins an agent
 * forever with no error and no way back — the run just never finishes.
 *
 * `CONNECT_MS` bounds time-to-response-headers only; generation itself may take
 * far longer and is bounded instead by `IDLE_MS`, the gap between two stream
 * chunks. A long think is normal, total silence is not.
 */
const CONNECT_MS = 60_000;
const IDLE_MS = 120_000;

/** Distinguishable from a user cancel, which must not read as a failure. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * A signal that aborts on the caller's cancel *or* after `ms`, reporting which
 * happened — an abort attributed to the wrong cause shows "Cancelled" on what
 * was really a timeout.
 */
function withDeadline(ms: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const state = { timedOut: false };
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    state.timedOut = true;
    ctrl.abort();
  }, ms);
  return {
    signal: ctrl.signal,
    get timedOut() {
      return state.timedOut;
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * `reader.read()` bounded by an idle timeout. Cancels the reader on stall so
 * the socket closes instead of leaking.
 */
async function readOrStall<T>(
  reader: ReadableStreamDefaultReader<T>,
  ms = IDLE_MS,
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new TimeoutError(`Claude stopped sending data for ${Math.round(ms / 1000)}s.`));
    }, ms);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Iterate the decoded JSON payloads of an SSE response.
 *
 * Both stream functions parsed frames identically — read, decode, split on the
 * blank line, strip `data:`, JSON.parse — so the mechanics live here once and
 * each caller keeps only its own event handling. Carries the idle-stall guard,
 * so every consumer inherits it.
 */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await readOrStall(reader);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    // The tail is whatever arrived mid-frame; hold it for the next chunk.
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        yield JSON.parse(payload);
      } catch {
        // Keep-alive or truncated frame — skip it rather than kill the stream.
      }
    }
  }
}

/** Transient failures worth another attempt: rate limits and overload. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 4;

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * POST to the Messages API and hand back a live streaming response.
 *
 * Retries rate limits and overload (429/529 are routine on busy accounts) with
 * exponential backoff, honouring `retry-after` when the API sends one. Only
 * requests that never began streaming are retried, so no output is duplicated.
 */
async function postStream(body: unknown, apiKey: string, signal?: AbortSignal): Promise<Response> {
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    const deadline = withDeadline(CONNECT_MS, signal);
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          // Allow calling the API directly from a browser/webview context.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        signal: deadline.signal,
        body: JSON.stringify(body),
      });
    } catch (e) {
      // A timeout aborts the same way a cancel does; only the deadline knows
      // which it was, so check before treating it as the user's doing.
      if (deadline.timedOut) {
        lastError = `Claude did not respond within ${CONNECT_MS / 1000}s.`;
        if (attempt === MAX_ATTEMPTS - 1) throw new TimeoutError(lastError);
        await sleep(2 ** attempt * 500 + Math.random() * 250, signal);
        continue;
      }
      if (isAbort(e)) throw e;
      // Offline or DNS blip — worth one more try.
      lastError = `Network error reaching Claude: ${(e as Error).message}`;
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(lastError);
      await sleep(2 ** attempt * 500 + Math.random() * 250, signal);
      continue;
    } finally {
      deadline.dispose();
    }

    if (res.ok && res.body) return res;

    const detail = await res.text().catch(() => "");
    lastError = `Claude API error ${res.status}: ${detail || res.statusText}`;
    if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS - 1) throw new Error(lastError);

    const retryAfter = Number(res.headers?.get?.("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 500 + Math.random() * 250;
    await sleep(waitMs, signal);
  }

  throw new Error(lastError);
}

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  signal?: AbortSignal;
}

export interface ChatRequest {
  apiKey: string;
  model: ModelId;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** Response-shape constraint (structured outputs), merged into output_config. */
  outputConfig?: Record<string, unknown>;
}

/* ----------------------------- Tool use ------------------------------- */

/** A client-executed tool definition (JSON-schema input). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
/** A server-executed tool (e.g. Anthropic web search). */
export type ServerTool = { type: string; name: string } & Record<string, unknown>;
export type AnyTool = ToolDef | ServerTool;

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ApiContent =
  | { type: "text"; text: string; citations?: unknown[] }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | ToolResultBlock[]; is_error?: boolean }
  | PassthroughBlock;

/**
 * Blocks the app never reads but must send back byte-for-byte: thinking (its
 * signature binds it to this exact conversation), and server-tool calls and
 * results (web search, web fetch, code execution). Dropping or rewriting them
 * loses the model's reasoning mid-loop and can 400 on newer accounts.
 */
export type PassthroughBlock = {
  type:
    | "thinking"
    | "redacted_thinking"
    | "server_tool_use"
    | "web_search_tool_result"
    | "web_fetch_tool_result"
    | "code_execution_tool_result"
    | "bash_code_execution_tool_result"
    | "text_editor_code_execution_tool_result";
  [key: string]: unknown;
};

/** Rich tool-result content: text plus images (a screenshot, say). */
export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ApiContent[];
}

export interface MessageRequest {
  apiKey: string;
  model: ModelId;
  system: string;
  messages: ApiMessage[];
  temperature: number;
  maxTokens: number;
  tools?: AnyTool[];
  /** Code-execution container to reuse, so files and state survive between steps. */
  container?: string;
}

export interface MessageResult {
  text: string;
  content: ApiContent[];
  toolUses: ToolUse[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Code-execution container this turn ran in, if any. */
  container?: string;
}

/**
 * One streamed turn of the Messages API, with tool-use support. Text deltas go
 * to `onText`; tool_use blocks are accumulated and returned so the caller can
 * run an agentic loop (execute tools → feed results back → call again).
 */
export async function streamMessage(req: MessageRequest, cb: StreamCallbacks): Promise<MessageResult> {
  if (!req.apiKey) {
    throw new Error("No API key set. Add your Claude API key in Settings → API.");
  }

  const res = await postStream(
    {
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
      output_config: supportsAdaptiveThinking(req.model) ? { effort: DEFAULT_EFFORT } : undefined,
      tools: req.tools && req.tools.length ? req.tools : undefined,
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
  const blocks: Record<number, Record<string, any>> = {};

  for await (const json of sseEvents(res.body!)) {
    switch (json.type) {
      case "message_start":
        inputTokens = json.message?.usage?.input_tokens ?? inputTokens;
        container = json.message?.container?.id ?? container;
        break;
      case "content_block_start": {
        const b = json.content_block;
        if (!b?.type) break;
        const blk: Record<string, any> = { ...b };
        // Tool inputs arrive as JSON fragments; the start event's `{}` is a placeholder.
        if (b.type === "tool_use" || b.type === "server_tool_use") blk._partialJson = "";
        blocks[json.index as number] = blk;
        break;
      }
      case "content_block_delta": {
        const blk = blocks[json.index as number];
        const d = json.delta;
        if (!blk || !d) break;
        switch (d.type) {
          case "text_delta":
            text += d.text;
            blk.text = (blk.text ?? "") + d.text;
            cb.onText(d.text);
            break;
          case "citations_delta":
            (blk.citations ??= []).push(d.citation);
            break;
          case "thinking_delta":
            blk.thinking = (blk.thinking ?? "") + d.thinking;
            break;
          case "signature_delta":
            blk.signature = d.signature;
            break;
          case "input_json_delta":
            blk._partialJson = (blk._partialJson ?? "") + d.partial_json;
            break;
        }
        break;
      }
      case "content_block_stop": {
        const blk = blocks[json.index as number];
        if (blk && "_partialJson" in blk) {
          try {
            blk.input = blk._partialJson ? JSON.parse(blk._partialJson) : {};
          } catch {
            blk.input = {};
          }
          delete blk._partialJson;
        }
        break;
      }
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
    .map((i) => blocks[i] as ApiContent);

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
export async function streamChat(req: ChatRequest, cb: StreamCallbacks): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  if (!req.apiKey) {
    throw new Error("No API key set. Add your Claude API key in Settings → API.");
  }

  const res = await postStream(
    {
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
      // effort and format share one object; sending two output_config keys
      // would drop one silently.
      output_config:
        supportsAdaptiveThinking(req.model) || req.outputConfig
          ? {
              ...(supportsAdaptiveThinking(req.model) ? { effort: DEFAULT_EFFORT } : {}),
              ...(req.outputConfig ?? {}),
            }
          : undefined,
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
        if (json.delta?.type === "text_delta") {
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
