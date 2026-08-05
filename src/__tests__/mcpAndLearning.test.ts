import { describe, it, expect, beforeEach } from "vitest";
import { resetStores } from "@/test/reset";
import { buildMcpConfig, splitArgs } from "@/lib/mcp";
import { useBrains } from "@/stores/brains";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import { buildTools, runTool } from "@/lib/tools";
import type { McpServer } from "@/types/domain";

const srv = (over: Partial<McpServer>): McpServer => ({
  id: "s1",
  name: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  enabled: true,
  ...over,
});

beforeEach(() => resetStores());

describe("buildMcpConfig", () => {
  it("returns undefined when the pack mounts no runnable servers", () => {
    expect(buildMcpConfig({ mcpServers: undefined })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ enabled: false })] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ command: "" })] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ transport: "http", url: "" })] })).toBeUndefined();
  });

  it("builds the CLI shape for stdio and http servers", () => {
    const json = buildMcpConfig({
      mcpServers: [
        srv({ env: { GITHUB_TOKEN: "t" } }),
        srv({ id: "s2", name: "docs", transport: "http", url: "https://mcp.example.com" }),
      ],
    })!;
    const cfg = JSON.parse(json);
    expect(cfg.mcpServers.github).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "t" },
    });
    expect(cfg.mcpServers.docs).toEqual({ type: "http", url: "https://mcp.example.com" });
  });

  it("splitArgs tokenizes on whitespace", () => {
    expect(splitArgs("  -y   @scope/pkg  --flag ")).toEqual(["-y", "@scope/pkg", "--flag"]);
  });
});

describe("brain learning queue", () => {
  function wornAgent(reviewLearning: boolean) {
    const brain = useBrains.getState().createBrain({ name: "Hive", sharedMemory: true, reviewLearning });
    const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
    const a = useGaps.getState().addAgent(gap.id, {
      name: "Scout",
      role: "R",
      skills: [{ id: "m", name: "Memory", description: "", kind: "memory", enabled: true }],
    });
    useGaps.getState().updateAgent(a.id, { brainId: brain.id });
    return { brain, agent: useGaps.getState().findAgent(a.id)!.agent };
  }

  it("queues remembered facts as pending when review is on, and hides them from recall", async () => {
    const { brain, agent } = wornAgent(true);
    const { executors } = buildTools(agent);

    const out = await runTool("remember", { text: "ship on Friday" }, executors, { agent });
    expect(out).toContain("Queued for review");

    const key = `brain:${brain.id}`;
    const pending = useMemory.getState().pendingFor(key);
    expect(pending).toHaveLength(1);
    expect(pending[0].proposedBy).toBe("Scout");

    // Pending facts are never recalled…
    const recallOut = await runTool("recall", { query: "Friday" }, executors, { agent });
    expect(recallOut).toBe("No relevant memories.");

    // …until approved.
    useMemory.getState().approve(pending[0].id);
    expect(useMemory.getState().pendingFor(key)).toHaveLength(0);
    const after = await runTool("recall", { query: "Friday" }, executors, { agent });
    expect(after).toContain("ship on Friday");
  });

  it("rejecting drops the fact entirely", async () => {
    const { brain, agent } = wornAgent(true);
    const { executors } = buildTools(agent);
    await runTool("remember", { text: "wrong fact" }, executors, { agent });

    const key = `brain:${brain.id}`;
    useMemory.getState().reject(useMemory.getState().pendingFor(key)[0].id);
    expect(useMemory.getState().notes).toHaveLength(0);
  });

  it("saves immediately when review is off", async () => {
    const { brain, agent } = wornAgent(false);
    const { executors } = buildTools(agent);
    const out = await runTool("remember", { text: "instant" }, executors, { agent });
    expect(out).toBe("Saved to memory.");
    expect(useMemory.getState().pendingFor(`brain:${brain.id}`)).toHaveLength(0);
    expect(useMemory.getState().forAgent(`brain:${brain.id}`)).toHaveLength(1);
  });
});
