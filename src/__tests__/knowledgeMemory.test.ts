import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores } from "@/test/reset";
import { mockStreamingFetch, textTurn } from "@/test/mockClaude";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import { useSettings } from "@/stores/settings";
import { runAgentHeadless } from "@/lib/agentRun";
import { buildTools, runTool } from "@/lib/tools";
import { foldBrainsIntoAgents } from "@/lib/foldBrains";

// Keyword retrieval only: never download an embedding model in tests.
vi.mock("@/lib/embeddings", () => ({ embeddingsAvailable: () => false, embed: async () => null, cosine: () => 0 }));

function makeAgent(memorySkill = false) {
  const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
  const a = useGaps.getState().addAgent(gap.id, {
    name: "Scout",
    role: "Researcher",
    skills: memorySkill ? [{ id: "m", name: "Memory", description: "", kind: "memory", enabled: true }] : [],
  });
  return useGaps.getState().findAgent(a.id)!.agent;
}

const systemOf = (spy: any) => JSON.parse(spy.mock.calls[0][1].body).system.map((b: any) => b.text).join("\n");

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key" });
});
afterEach(() => vi.unstubAllGlobals());

describe("what an agent knows reaches every answer", () => {
  it("hands the agent its memories without it having to ask", async () => {
    const agent = makeAgent();
    useMemory.getState().remember(agent.id, "The user's name is Ada");
    const spy = mockStreamingFetch([textTurn("ok")]);

    await runAgentHeadless(agent, "what's my name?");

    expect(systemOf(spy)).toContain("The user's name is Ada");
  });

  it("never shows facts still waiting for approval", async () => {
    const agent = makeAgent();
    useMemory.getState().propose(agent.id, "Unvetted claim", "Scout");
    const spy = mockStreamingFetch([textTurn("ok")]);

    await runAgentHeadless(agent, "claim?");

    expect(systemOf(spy)).not.toContain("Unvetted claim");
  });

  it("includes matching documents", async () => {
    const agent = makeAgent();
    useGaps.getState().addKnowledge(agent.id, { title: "Policy", content: "Refunds are issued within 14 days.", bytes: 34 });
    const spy = mockStreamingFetch([textTurn("ok")]);

    await runAgentHeadless(useGaps.getState().findAgent(agent.id)!.agent, "how long do refunds take?");

    expect(systemOf(spy)).toContain("14 days");
  });

  it("caches the system prompt so it is not re-billed every turn", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    await runAgentHeadless(makeAgent(), "hello");
    expect(JSON.parse(spy.mock.calls[0][1].body).system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("remember", () => {
  it("is the only memory tool — no recall, since memories arrive on their own", () => {
    const names = buildTools(makeAgent(true)).defs.map((d: any) => d.name);
    expect(names).toContain("remember");
    expect(names).not.toContain("recall");
  });

  it("saves straight away when review is off", async () => {
    const agent = makeAgent(true);
    await runTool("remember", { text: "ship on Friday" }, buildTools(agent).executors, { agent });
    expect(useMemory.getState().forAgent(agent.id).map((n) => n.status)).toEqual([undefined]);
  });

  it("waits for the user's OK when review is on", async () => {
    const agent = { ...makeAgent(true), reviewMemory: true };
    const out = await runTool("remember", { text: "ship on Friday" }, buildTools(agent).executors, { agent });
    expect(out).toMatch(/approval/);
    expect(useMemory.getState().pendingFor(agent.id)).toHaveLength(1);
  });
});

describe("folding old brains into agents", () => {
  it("moves a brain's settings, documents and shared memory onto each agent that wore it", () => {
    const a = makeAgent();
    const b = makeAgent();
    useGaps.getState().updateAgent(a.id, { brainId: "br" } as any);
    useGaps.getState().updateAgent(b.id, { brainId: "br" } as any);
    useMemory.getState().remember("brain:br", "Team prefers metric units");
    localStorage.setItem(
      "forge.brains",
      JSON.stringify({
        state: {
          brains: [
            {
              id: "br",
              model: "claude-sonnet-5",
              systemAppend: "Answer tersely.",
              knowledge: [{ id: "k", title: "Glossary", content: "x", bytes: 1, addedAt: 1 }],
              sharedMemory: true,
              reviewLearning: true,
            },
          ],
        },
      }),
    );

    expect(foldBrainsIntoAgents()).toBe(2);

    for (const id of [a.id, b.id]) {
      const agent: any = useGaps.getState().findAgent(id)!.agent;
      expect(agent.brainId).toBeUndefined();
      expect(agent.model).toBe("claude-sonnet-5-5"); // old id migrated on the way
      expect(agent.systemPrompt).toMatch(/Answer tersely\.$/);
      expect(agent.knowledge.map((d: any) => d.title)).toEqual(["Glossary"]);
      expect(agent.reviewMemory).toBe(true);
      expect(useMemory.getState().forAgent(id).map((n) => n.text)).toEqual(["Team prefers metric units"]);
    }
    expect(useMemory.getState().forAgent("brain:br")).toHaveLength(0);
    expect(localStorage.getItem("forge.brains")).toBeNull();
  });

  it("does nothing once there is nothing left to fold", () => {
    expect(foldBrainsIntoAgents()).toBe(0);
  });
});
