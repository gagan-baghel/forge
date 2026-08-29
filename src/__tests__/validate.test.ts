import { describe, it, expect } from "vitest";
import { asAgentSeeds, extractJsonObject, InvalidPayload } from "@/lib/validate";
import { parseGapFile, encodeShareCode } from "@/lib/gapfile";
import { buildGap } from "@/lib/seed";

/** The ways a real model turn goes wrong. */
describe("model output extraction", () => {
  it("pulls JSON out of prose and code fences", () => {
    expect(extractJsonObject('Sure! ```json\n{"a":1}\n``` hope that helps')).toEqual({ a: 1 });
  });

  it("names the problem when the model answered in prose", () => {
    expect(() => extractJsonObject("I'd be happy to help with that!")).toThrow(/did not contain a JSON object/);
  });

  it("names the problem when the model was cut off mid-object", () => {
    // max_tokens truncation — the classic one.
    expect(() => extractJsonObject('{"name":"Half a pa')).toThrow(/did not contain a JSON object/);
  });

  it("names the problem when the JSON is malformed", () => {
    expect(() => extractJsonObject('{"name": "x",,}')).toThrow(/not valid JSON/);
  });
});

describe("agent validation", () => {
  it("rejects output with no agents field — the crash that reached create()", () => {
    expect(() => asAgentSeeds(undefined, "agents")).toThrow(InvalidPayload);
  });

  it("rejects agents that came back as a string", () => {
    expect(() => asAgentSeeds("Researcher and Writer", "agents")).toThrow(/must be an array/);
  });

  it("rejects an empty roster", () => {
    expect(() => asAgentSeeds([], "agents")).toThrow(/at least one agent/);
  });

  it("rejects an agent missing its name", () => {
    expect(() => asAgentSeeds([{ role: "writer" }], "agents")).toThrow(/agents\[0\].name is missing/);
  });

  it("caps a runaway roster", () => {
    expect(() => asAgentSeeds(Array.from({ length: 99 }, () => ({ name: "a" })), "agents")).toThrow(/more than/);
  });

  it("fills optional fields rather than failing on them", () => {
    expect(asAgentSeeds([{ name: "Scout" }], "agents")[0]).toMatchObject({ name: "Scout", role: "", systemPrompt: "" });
  });
});

describe(".gap import", () => {
  const validGap = () =>
    buildGap({
      slug: "pack",
      name: "Pack",
      description: "d",
      emoji: "📦",
      color: "#6D5BFF",
      tags: [],
      agents: [{ name: "A", role: "r", emoji: "🔍", systemPrompt: "p" }],
    });

  it("round-trips a real pack through a share code", () => {
    expect(parseGapFile(atob(encodeShareCode(validGap()).replace(/^forge:/, "")))).toMatchObject({ name: "Pack" });
  });

  it("rejects a pack whose agents were hand-edited away", () => {
    const bad = JSON.stringify({ magic: "forge.gap/v1", gap: { name: "Pack", agents: "none" } });
    expect(() => parseGapFile(bad)).toThrow(/must be an array/);
  });

  it("rejects a truncated file without a JSON crash", () => {
    expect(() => parseGapFile('{"magic":"forge.gap/v1","gap":{')).toThrow(/Not a valid .gap file/);
  });
});
