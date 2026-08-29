import { describe, it, expect, beforeEach } from "vitest";
import { streamChat, streamMessage } from "@/lib/claude";
import { routeModel, supportsAdaptiveThinking, UTILITY_MODEL } from "@/lib/aiConfig";
import { mockStreamingFetch, textTurn } from "@/test/mockClaude";
import type { ChatMessage } from "@/types/domain";

const msgs: ChatMessage[] = [{ id: "u", role: "user", content: "hi", createdAt: 1 }];
const base = { apiKey: "k", system: "s", temperature: 0.7, maxTokens: 100 };

const bodyOf = (spy: any) => JSON.parse(spy.mock.calls[0][1].body);

beforeEach(() => localStorage.clear());

describe("adaptive thinking + effort", () => {
  it("sends adaptive thinking and an effort level on Claude 5 models", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    await streamChat({ ...base, model: "claude-opus-5", messages: msgs }, { onText: () => {} });

    const body = bodyOf(spy);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("high");
    // budget_tokens was removed on these models — sending it is a 400.
    expect(body.thinking.budget_tokens).toBeUndefined();
  });

  it("sends neither on Haiku 4.5, which predates both", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    await streamChat({ ...base, model: "claude-haiku-4-5", messages: msgs }, { onText: () => {} });

    const body = bodyOf(spy);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    // ...but Haiku still accepts temperature.
    expect(body.temperature).toBe(0.7);
  });

  it("applies to the tool-use path too", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    await streamMessage(
      { ...base, model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] as any },
      { onText: () => {} },
    );
    expect(bodyOf(spy).output_config.effort).toBe("high");
  });
});

describe("structured outputs", () => {
  it("merges a caller schema and effort into ONE output_config", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    const schema = { type: "object", properties: { a: { type: "string" } } };
    await streamChat(
      { ...base, model: "claude-opus-5", messages: msgs, outputConfig: { format: { type: "json_schema", schema } } },
      { onText: () => {} },
    );

    const oc = bodyOf(spy).output_config;
    // Two separate output_config keys would silently drop one.
    expect(oc.effort).toBe("high");
    expect(oc.format.type).toBe("json_schema");
    expect(oc.format.schema).toEqual(schema);
  });

  it("carries a schema even on a model with no effort support", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    await streamChat(
      { ...base, model: "claude-haiku-4-5", messages: msgs, outputConfig: { format: { type: "json_schema", schema: {} } } },
      { onText: () => {} },
    );
    const oc = bodyOf(spy).output_config;
    expect(oc.format.type).toBe("json_schema");
    expect(oc.effort).toBeUndefined();
  });
});

describe("model routing", () => {
  it("routes mechanical work to the cheap model", () => {
    expect(routeModel("utility", "claude-opus-5")).toBe(UTILITY_MODEL);
  });

  it("never downgrades the model the user chose for real reasoning", () => {
    expect(routeModel("reasoning", "claude-opus-5")).toBe("claude-opus-5");
    expect(routeModel("reasoning", "claude-fable-5")).toBe("claude-fable-5");
  });

  it("knows which models take adaptive thinking", () => {
    expect(supportsAdaptiveThinking("claude-opus-5")).toBe(true);
    expect(supportsAdaptiveThinking("claude-sonnet-5")).toBe(true);
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false);
  });
});
