import { describe, it, expect } from "vitest";
import { normalizeGap } from "@/lib/gapSchema";
import { decodeShareCode, encodeShareCode, parseGapFile } from "@/lib/gapfile";
import { MODELS } from "@/types/domain";

const minimal = { name: "Pack", agents: [{ name: "Scout" }] };

describe("normalizeGap", () => {
  it("fills every field the app reads on a minimal hand-made pack", () => {
    const gap = normalizeGap(minimal);
    expect(gap).toMatchObject({ name: "Pack", slug: "pack", tags: [], version: "1.0.0", source: "imported" });
    expect(gap.agents[0]).toMatchObject({
      name: "Scout",
      skills: [],
      knowledge: [],
      connectors: [],
      channels: [],
      status: "active",
      temperature: 0.7,
    });
  });

  it("names the field when a present value has the wrong type", () => {
    expect(() => normalizeGap({ ...minimal, tags: "a,b" })).toThrow("gap.tags must be an array.");
    expect(() => normalizeGap({ name: "P", agents: [{ name: "A", skills: {} }] })).toThrow(
      "gap.agents[0].skills must be an array.",
    );
    expect(() => normalizeGap({ name: 5, agents: [{ name: "A" }] })).toThrow("gap.name must be a string.");
  });

  it("requires agents, unless the caller allows an empty pack", () => {
    expect(() => normalizeGap({ name: "P", agents: [] })).toThrow(/at least one agent/);
    expect(normalizeGap({ name: "P", agents: [] }, { allowNoAgents: true }).agents).toEqual([]);
  });

  it("clamps numbers and maps unknown enum values to safe defaults", () => {
    const a = normalizeGap({
      name: "P",
      agents: [
        { name: "A", temperature: 9, maxTokens: -5, status: "weird", model: "gpt-9", skills: [{ kind: "rm-rf" }] },
      ],
    }).agents[0];
    expect(a.temperature).toBe(1);
    expect(a.maxTokens).toBe(1);
    expect(a.status).toBe("active");
    expect(a.model).toBe(MODELS[0].id);
    expect(a.skills[0].kind).toBe("custom");
  });

  it("moves a retired model id to its successor", () => {
    expect(normalizeGap({ name: "P", agents: [{ name: "A", model: "claude-sonnet-5" }] }).agents[0].model).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("imports MCP servers switched off unless explicitly enabled", () => {
    const g = normalizeGap({ ...minimal, mcpServers: [{ name: "gh", command: "npx" }] });
    expect(g.mcpServers?.[0]).toMatchObject({ name: "gh", transport: "stdio", enabled: false });
  });

  it("caps oversize payloads", () => {
    const agents = Array.from({ length: 30 }, (_, i) => ({ name: `A${i}` }));
    expect(() => normalizeGap({ name: "P", agents })).toThrow(/more than 24/);
  });
});

describe(".gap files and share codes", () => {
  it("round-trips a pack through a share code", () => {
    const gap = normalizeGap(minimal);
    expect(decodeShareCode(encodeShareCode(gap)).name).toBe("Pack");
  });

  it("rejects garbage with a readable message", () => {
    expect(() => decodeShareCode("forge:%%%not-base64")).toThrow("Not a valid share code.");
    expect(() => parseGapFile("{")).toThrow("Not a valid .gap file.");
    expect(() => parseGapFile(JSON.stringify({ magic: "nope", gap: minimal }))).toThrow("Not a valid .gap file.");
  });
});
