import { describe, it, expect } from "vitest";
import { streamMessage } from "@/lib/claude";
import { mockStreamingFetch, textTurn, toolTurn } from "@/test/mockClaude";

describe("streamMessage (SSE parsing)", () => {
  it("streams text and reports usage", async () => {
    mockStreamingFetch([textTurn("Hello there!", 12, 7)]);
    const chunks: string[] = [];
    const res = await streamMessage(
      { apiKey: "k", model: "claude-opus-4-8", system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.7, maxTokens: 256 },
      { onText: (d) => chunks.push(d) },
    );
    expect(res.text).toBe("Hello there!");
    expect(chunks.join("")).toBe("Hello there!");
    expect(res.inputTokens).toBe(12);
    expect(res.outputTokens).toBe(7);
    expect(res.stopReason).toBe("end_turn");
    expect(res.toolUses).toHaveLength(0);
  });

  it("parses a tool_use block with accumulated JSON input", async () => {
    mockStreamingFetch([toolTurn("http_request", { url: "https://example.com" })]);
    const res = await streamMessage(
      { apiKey: "k", model: "claude-opus-4-8", system: "", messages: [{ role: "user", content: "fetch" }], temperature: 0.7, maxTokens: 256, tools: [] },
      { onText: () => {} },
    );
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolUses).toHaveLength(1);
    expect(res.toolUses[0].name).toBe("http_request");
    expect(res.toolUses[0].input).toEqual({ url: "https://example.com" });
  });

  it("throws without an API key", async () => {
    await expect(
      streamMessage(
        { apiKey: "", model: "claude-opus-4-8", system: "", messages: [], temperature: 0.7, maxTokens: 256 },
        { onText: () => {} },
      ),
    ).rejects.toThrow(/API key/i);
  });
});
