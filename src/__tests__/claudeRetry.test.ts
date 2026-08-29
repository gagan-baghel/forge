import { describe, it, expect, vi, afterEach } from "vitest";
import { streamMessage } from "@/lib/claude";
import { textTurn } from "@/test/mockClaude";

/** A non-2xx response, shaped like the bits `postStream` actually touches. */
function errorResponse(status: number, retryAfter?: string) {
  return {
    ok: false,
    status,
    statusText: "Error",
    body: null,
    headers: { get: (h: string) => (h === "retry-after" ? (retryAfter ?? null) : null) },
    text: () => Promise.resolve(`{"error":{"message":"status ${status}"}}`),
  };
}

function okResponse(events: unknown[]) {
  const enc = new TextEncoder();
  const frames = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => ({
        read: () =>
          i < frames.length
            ? Promise.resolve({ done: false, value: frames[i++] })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
    text: () => Promise.resolve(""),
  };
}

/** Queue of responses, one per fetch call. */
function mockSequence(responses: unknown[]) {
  let call = 0;
  const spy = vi.fn(() => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return Promise.resolve(r as Response);
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

const req = {
  apiKey: "k",
  model: "claude-opus-5" as const,
  system: "",
  messages: [{ role: "user" as const, content: "hi" }],
  temperature: 0.7,
  maxTokens: 256,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Claude API retry", () => {
  it("retries a 429 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const spy = mockSequence([errorResponse(429), okResponse(textTurn("recovered", 3, 2))]);

    const promise = streamMessage(req, { onText: () => {} });
    await vi.advanceTimersByTimeAsync(5000);
    const res = await promise;

    expect(res.text).toBe("recovered");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries 529 overloaded", async () => {
    vi.useFakeTimers();
    const spy = mockSequence([errorResponse(529), errorResponse(529), okResponse(textTurn("ok", 1, 1))]);

    const promise = streamMessage(req, { onText: () => {} });
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 400 — a bad request will fail identically every time", async () => {
    const spy = mockSequence([errorResponse(400)]);

    await expect(streamMessage(req, { onText: () => {} })).rejects.toThrow(/400/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt cap and surfaces the last error", async () => {
    vi.useFakeTimers();
    const spy = mockSequence([errorResponse(529)]);

    const promise = streamMessage(req, { onText: () => {} });
    const assertion = expect(promise).rejects.toThrow(/529/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("honours retry-after instead of backoff when the API sends it", async () => {
    vi.useFakeTimers();
    const spy = mockSequence([errorResponse(429, "2"), okResponse(textTurn("waited", 1, 1))]);

    const promise = streamMessage(req, { onText: () => {} });

    // Not yet — retry-after asked for 2s.
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
