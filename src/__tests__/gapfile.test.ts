import { describe, it, expect } from "vitest";
import { exportGap, parseGapFile, encodeShareCode, decodeShareCode } from "@/lib/gapfile";
import { buildGap } from "@/lib/seed";

function sampleGap() {
  return buildGap({
    slug: "test-pack",
    name: "Test Pack",
    description: "A pack for tests",
    emoji: "🧪",
    color: "#6D5BFF",
    tags: ["test"],
    agents: [{ name: "Tester", role: "QA", emoji: "🤖", systemPrompt: "You test things." }],
  });
}

describe("gap file", () => {
  it("round-trips through export/parse", () => {
    const gap = sampleGap();
    const parsed = parseGapFile(exportGap(gap));
    expect(parsed.name).toBe("Test Pack");
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe("Tester");
  });

  it("round-trips through a share code", () => {
    const gap = sampleGap();
    const code = encodeShareCode(gap);
    expect(code.startsWith("forge:")).toBe(true);
    const decoded = decodeShareCode(code);
    expect(decoded.slug).toBe("test-pack");
    expect(decoded.agents[0].systemPrompt).toBe("You test things.");
  });

  it("rejects an invalid file", () => {
    expect(() => parseGapFile('{"magic":"nope"}')).toThrow();
    expect(() => decodeShareCode("garbage")).toThrow();
  });

  it("strips env secrets on export but keeps the keys", () => {
    const gap = {
      ...sampleGap(),
      env: { API_TOKEN: "super-secret", REGION: "eu" },
      mcpServers: [
        {
          id: "m1",
          name: "github",
          transport: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_secret" },
          enabled: true,
        },
      ],
    };
    const parsed = parseGapFile(exportGap(gap));
    // Keys survive as documentation; values never leave the machine.
    expect(parsed.env).toEqual({ API_TOKEN: "", REGION: "" });
    expect(parsed.mcpServers?.[0].env).toEqual({ GITHUB_TOKEN: "" });
    // Non-secret server config is intact.
    expect(parsed.mcpServers?.[0].command).toBe("npx");
    // The original object is untouched (export must not mutate the store).
    expect(gap.env.API_TOKEN).toBe("super-secret");
  });
});
