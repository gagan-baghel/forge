import { describe, it, expect } from "vitest";
import { buildTools } from "@/lib/tools";
import type { Agent } from "@/types/domain";

function agent(partial: Partial<Agent>): Agent {
  return {
    id: "a1",
    gapId: "g1",
    name: "A",
    role: "r",
    emoji: "🤖",
    systemPrompt: "",
    model: "claude-opus-4-8",
    temperature: 0.7,
    maxTokens: 256,
    status: "ready",
    skills: [],
    knowledge: [],
    connectors: [],
    channels: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("buildTools", () => {
  it("adds the server web_search tool for the web_search skill", () => {
    const { defs } = buildTools(agent({ skills: [{ id: "s", name: "Web", kind: "web_search", description: "", enabled: true }] }));
    expect(defs.some((d) => (d as any).type === "web_search_20250305")).toBe(true);
  });

  it("adds executable client tools for http + memory skills", () => {
    const { defs, executors } = buildTools(
      agent({
        skills: [
          { id: "1", name: "HTTP", kind: "http", description: "", enabled: true },
          { id: "2", name: "Mem", kind: "memory", description: "", enabled: true },
        ],
      }),
    );
    const names = defs.map((d) => (d as any).name);
    expect(names).toContain("http_request");
    expect(names).toContain("remember");
    expect(names).toContain("recall");
    expect(typeof executors["http_request"]).toBe("function");
  });

  it("ignores disabled skills", () => {
    const { defs } = buildTools(agent({ skills: [{ id: "1", name: "HTTP", kind: "http", description: "", enabled: false }] }));
    expect(defs).toHaveLength(0);
  });

  it("exposes a connector tool only when connected", () => {
    const connected = buildTools(
      agent({ connectors: [{ id: "c", provider: "github", label: "GitHub", status: "connected", scopes: ["tok"] }] }),
    );
    expect(connected.defs.some((d) => (d as any).name === "github_api")).toBe(true);

    const disconnected = buildTools(
      agent({ connectors: [{ id: "c", provider: "github", label: "GitHub", status: "disconnected" }] }),
    );
    expect(disconnected.defs.some((d) => (d as any).name === "github_api")).toBe(false);
  });
});
