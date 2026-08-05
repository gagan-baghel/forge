import { vi } from "vitest";

/**
 * Build a fake `fetch` Response whose body streams the given SSE event objects
 * the way the Anthropic Messages API does. Each object becomes a
 * `data: {json}\n\n` frame. Matches what `streamMessage`/`streamChat` parse.
 */
function sseResponse(events: unknown[]) {
  const enc = new TextEncoder();
  const frames = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader() {
        return {
          read() {
            if (i < frames.length) return Promise.resolve({ done: false, value: frames[i++] });
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    text: () => Promise.resolve(""),
  };
}

/** A simple text-only assistant turn. */
export function textTurn(text: string, inputTokens = 10, outputTokens = 5) {
  return [
    { type: "message_start", message: { usage: { input_tokens: inputTokens } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outputTokens } },
    { type: "message_stop" },
  ];
}

/** A turn that requests a single tool call. */
export function toolTurn(toolName: string, input: Record<string, unknown>, id = "tool_1") {
  return [
    { type: "message_start", message: { usage: { input_tokens: 8 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: toolName, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ];
}

/**
 * Install a fetch mock that returns each provided turn (array of SSE events) in
 * sequence, one per call. Returns the spy so tests can assert call counts.
 */
export function mockStreamingFetch(turns: unknown[][]) {
  let call = 0;
  const spy = vi.fn().mockImplementation(() => {
    const events = turns[Math.min(call, turns.length - 1)];
    call++;
    return Promise.resolve(sseResponse(events));
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
