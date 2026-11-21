/**
 * HTTP + SSE plumbing for the Messages API: deadlines, idle guards, retries
 * with exponential backoff, and frame decoding. Knows nothing about content.
 */
import type { SseEvent } from "./types";
import { logger } from "../log";

const log = logger("claude");

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

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

/** Transient failures worth another attempt: rate limits and overload. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 500;
const BACKOFF_JITTER_MS = 250;

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
 * Iterate the decoded JSON payloads of an SSE response. Carries the
 * idle-stall guard, so every consumer inherits it.
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
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
        yield JSON.parse(payload) as SseEvent;
      } catch {
        // Keep-alive or truncated frame — skip it rather than kill the stream.
      }
    }
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * BACKOFF_BASE_MS + Math.random() * BACKOFF_JITTER_MS;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    // Detach on the normal path too, or every retry leaves a listener on the turn's signal.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * POST to the Messages API and hand back a live streaming response.
 *
 * Retries rate limits and overload (429/529 are routine on busy accounts) with
 * exponential backoff, honouring `retry-after` when the API sends one. Only
 * requests that never began streaming are retried, so no output is duplicated.
 */
export async function postStream(body: unknown, apiKey: string, signal?: AbortSignal): Promise<Response> {
  if (!apiKey) throw new Error("No API key set. Add your Claude API key in Settings → API.");
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = attempt === MAX_ATTEMPTS - 1;
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
        if (last) throw new TimeoutError(lastError);
      } else {
        if (isAbort(e)) throw e;
        // Offline or DNS blip — worth another try.
        lastError = `Network error reaching Claude: ${(e as Error).message}`;
        if (last) throw new Error(lastError, { cause: e });
      }
      log.warn("request failed, retrying", { attempt, error: lastError });
      await sleep(backoffMs(attempt), signal);
      continue;
    } finally {
      deadline.dispose();
    }

    if (res.ok && res.body) return res;

    const detail = await res.text().catch(() => "");
    lastError = `Claude API error ${res.status}: ${detail || res.statusText}`;
    if (!RETRYABLE.has(res.status) || last) throw new Error(lastError);

    log.warn("retryable API status", { attempt, status: res.status });
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt), signal);
  }

  throw new Error(lastError);
}
