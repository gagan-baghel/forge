import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores } from "@/test/reset";
import { streamMessage } from "@/lib/claude";
import { pruneImages, runAgentHeadless } from "@/lib/agentRun";
import { buildTools } from "@/lib/tools";
import { mockStreamingFetch, textTurn } from "@/test/mockClaude";
import { useSettings } from "@/stores/settings";
import { useGaps } from "@/stores/gaps";
import type { Agent } from "@/types/domain";

const base = { apiKey: "k", model: "claude-opus-5-5" as const, system: "", temperature: 0.7, maxTokens: 100 };

/** A turn with thinking, a server-side search and its result, then text. */
function searchTurn(stop: string) {
  return [
    { type: "message_start", message: { usage: { input_tokens: 5 }, container: { id: "ctr_1" } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":"x"}' } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "u" }] } },
    { type: "content_block_stop", index: 2 },
    { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "part one. " } },
    { type: "content_block_delta", index: 3, delta: { type: "citations_delta", citation: { url: "u" } } },
    { type: "content_block_stop", index: 3 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 3 } },
  ];
}

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key" });
});
afterEach(() => vi.unstubAllGlobals());

describe("stream parser", () => {
  it("keeps thinking and server-tool blocks verbatim, in order", async () => {
    mockStreamingFetch([searchTurn("end_turn")]);
    const r = await streamMessage({ ...base, messages: [{ role: "user", content: "hi" }] }, { onText: () => {} });
    expect(r.content).toEqual([
      { type: "thinking", thinking: "plan", signature: "sig" },
      { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "x" } },
      { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "u" }] },
      { type: "text", text: "part one. ", citations: [{ url: "u" }] },
    ]);
    // Server tools never need a client executor.
    expect(r.toolUses).toEqual([]);
    expect(r.container).toBe("ctr_1");
  });
});

describe("agent loop", () => {
  it("resumes a paused turn by sending it back unchanged, and keeps both halves of the answer", async () => {
    const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
    const agent = useGaps.getState().addAgent(gap.id, { name: "Scout", role: "Researcher" });
    const spy = mockStreamingFetch([searchTurn("pause_turn"), textTurn("part two.")]);

    const res = await runAgentHeadless(agent, "go");

    expect(spy).toHaveBeenCalledTimes(2);
    const second = JSON.parse(spy.mock.calls[1][1].body);
    const echoed = second.messages[second.messages.length - 1];
    expect(echoed.role).toBe("assistant");
    expect(echoed.content[0]).toEqual({ type: "thinking", thinking: "plan", signature: "sig" });
    expect(second.container).toBe("ctr_1");
    expect(res.text).toBe("part one. part two.");
  });
});

describe("pruneImages", () => {
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } };
  const step = (id: string) => [
    { role: "assistant", content: [{ type: "thinking", thinking: "t", signature: "s" }, { type: "tool_use", id, name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [img] }] },
  ];

  it("drops thinking after the first edited message, never before it", () => {
    const messages: any[] = [{ role: "user", content: "go" }, ...step("a"), ...step("b"), ...step("c")];
    pruneImages(messages, 2);

    // The oldest screenshot (message 2) was replaced...
    expect(messages[2].content[0].content[0].type).toBe("text");
    // ...so the thinking before it survives, and every later one is gone.
    expect(messages[1].content[0].type).toBe("thinking");
    expect(messages[3].content.some((b: any) => b.type === "thinking")).toBe(false);
    expect(messages[5].content.some((b: any) => b.type === "thinking")).toBe(false);
  });

  it("leaves thinking alone when nothing was pruned", () => {
    const messages: any[] = [{ role: "user", content: "go" }, ...step("a")];
    pruneImages(messages, 2);
    expect(messages[1].content[0].type).toBe("thinking");
  });
});

describe("new tools", () => {
  const skill = (kind: any) => ({ id: kind, name: kind, kind, description: "", enabled: true });
  const mk = (model: any, kinds: string[]) =>
    ({ model, skills: kinds.map(skill), connectors: [] }) as unknown as Agent;
  const types = (a: Agent) => buildTools(a).defs.map((d: any) => d.type ?? d.name);

  it("pairs web search with full-page fetch at the matching version", () => {
    expect(types(mk("claude-opus-5-5", ["web_search"]))).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(types(mk("claude-haiku-5-5", ["web_search"]))).toEqual(["web_search_20250305", "web_fetch_20250910"]);
  });

  it("adds the Python sandbox, except beside the newer web tools that already run one", () => {
    expect(types(mk("claude-opus-5-5", ["code"]))).toContain("code_execution_20260521");
    expect(types(mk("claude-opus-5-5", ["code", "web_search"]))).not.toContain("code_execution_20260521");
    expect(types(mk("claude-haiku-5-5", ["code", "web_search"]))).toContain("code_execution_20260521");
  });

  it("gives the files skill a way to browse folders", () => {
    expect(types(mk("claude-opus-5-5", ["files"]))).toEqual(["read_file", "list_files"]);
  });
});
