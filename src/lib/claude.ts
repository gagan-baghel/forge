/**
 * Direct Claude API client (BYOK). Forge is local-first: chat calls go straight
 * from the app to the Anthropic API using the key the user stores in Settings.
 * No Forge-hosted backend sits in between.
 *
 * Streaming uses the Messages API SSE format. We parse the event stream
 * incrementally and surface text deltas plus a final usage record.
 */

import type { ChatMessage, ModelId } from "@/types/domain";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

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
        signal,
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      // Offline or DNS blip — worth one more try.
      lastError = `Network error reaching Claude: ${(e as Error).message}`;
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(lastError);
      await sleep(2 ** attempt * 500 + Math.random() * 250, signal);
      continue;
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
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

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
}

export interface MessageResult {
  text: string;
  content: ApiContent[];
  toolUses: ToolUse[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
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
      system: req.system || undefined,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      tools: req.tools && req.tools.length ? req.tools : undefined,
      messages: req.messages,
    },
    req.apiKey,
    cb.signal,
  );

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;

  // Track content blocks by index so we can assemble text + tool_use in order.
  const blocks: Record<number, ApiContent & { _partialJson?: string }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      switch (json.type) {
        case "message_start":
          inputTokens = json.message?.usage?.input_tokens ?? inputTokens;
          break;
        case "content_block_start": {
          const idx = json.index as number;
          const b = json.content_block;
          if (b?.type === "tool_use") {
            blocks[idx] = { type: "tool_use", id: b.id, name: b.name, input: {}, _partialJson: "" };
          } else if (b?.type === "text") {
            blocks[idx] = { type: "text", text: "" };
          }
          break;
        }
        case "content_block_delta": {
          const idx = json.index as number;
          const d = json.delta;
          if (d?.type === "text_delta") {
            text += d.text;
            const blk = blocks[idx];
            if (blk && blk.type === "text") blk.text += d.text;
            cb.onText(d.text);
          } else if (d?.type === "input_json_delta") {
            const blk = blocks[idx];
            if (blk && blk.type === "tool_use") blk._partialJson = (blk._partialJson ?? "") + d.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const idx = json.index as number;
          const blk = blocks[idx];
          if (blk && blk.type === "tool_use") {
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
          break;
      }
    }
  }

  cb.onUsage?.({ inputTokens, outputTokens });

  const content: ApiContent[] = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => {
      const b = blocks[i];
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      return { type: "text", text: (b as any).text };
    });

  const toolUses: ToolUse[] = content
    .filter((c): c is Extract<ApiContent, { type: "tool_use" }> => c.type === "tool_use")
    .map((c) => ({ id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown> }));

  return { text, content, toolUses, stopReason, inputTokens, outputTokens };
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
      system: req.system || undefined,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      messages: toApiMessages(req.messages),
    },
    req.apiKey,
    cb.signal,
  );

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
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
  }

  cb.onUsage?.({ inputTokens, outputTokens });
  return { text, inputTokens, outputTokens };
}
