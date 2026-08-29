import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores } from "@/test/reset";
import { mockStreamingFetch, textTurn } from "@/test/mockClaude";
import { useBrains, brainFor, agentsWearing, memoryKeyFor } from "@/stores/brains";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import { useSettings } from "@/stores/settings";
import { runAgentHeadless } from "@/lib/agentRun";
import { buildTools, runTool } from "@/lib/tools";

function makeAgent() {
  const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
  return useGaps.getState().addAgent(gap.id, { name: "Scout", role: "Researcher" });
}

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("brains store", () => {
  it("creates, updates and finds a brain", () => {
    const b = useBrains.getState().createBrain({ name: "Research mind" });
    expect(b.emoji).toBe("🧠");
    expect(b.sharedMemory).toBe(false);

    useBrains.getState().updateBrain(b.id, { description: "knows things", sharedMemory: true });
    const found = useBrains.getState().findBrain(b.id)!;
    expect(found.description).toBe("knows things");
    expect(found.sharedMemory).toBe(true);
  });

  it("attaches to any agent and reports who wears it", () => {
    const brain = useBrains.getState().createBrain({ name: "Mind" });
    const a1 = makeAgent();
    const a2 = makeAgent();

    useGaps.getState().updateAgent(a1.id, { brainId: brain.id });
    useGaps.getState().updateAgent(a2.id, { brainId: brain.id });

    expect(agentsWearing(brain.id).map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(brainFor(useGaps.getState().findAgent(a1.id)!.agent)?.id).toBe(brain.id);

    // Detach one — the other keeps wearing it.
    useGaps.getState().updateAgent(a1.id, { brainId: undefined });
    expect(agentsWearing(brain.id).map((a) => a.id)).toEqual([a2.id]);
  });

  it("deleting a brain detaches it from every agent", () => {
    const brain = useBrains.getState().createBrain({ name: "Mind" });
    const agent = makeAgent();
    useGaps.getState().updateAgent(agent.id, { brainId: brain.id });

    useBrains.getState().deleteBrain(brain.id);

    expect(useBrains.getState().brains).toHaveLength(0);
    expect(useGaps.getState().findAgent(agent.id)!.agent.brainId).toBeUndefined();
  });

  it("manages brain knowledge", () => {
    const brain = useBrains.getState().createBrain({ name: "Mind" });
    useBrains.getState().addKnowledge(brain.id, { title: "Guide", content: "Always be kind.", bytes: 15 });
    let found = useBrains.getState().findBrain(brain.id)!;
    expect(found.knowledge).toHaveLength(1);

    useBrains.getState().removeKnowledge(brain.id, found.knowledge[0].id);
    found = useBrains.getState().findBrain(brain.id)!;
    expect(found.knowledge).toHaveLength(0);
  });
});

describe("brain-aware memory", () => {
  it("keys memory by agent when no brain (or a private brain) is worn", () => {
    const agent = makeAgent();
    expect(memoryKeyFor(agent)).toBe(agent.id);

    const brain = useBrains.getState().createBrain({ name: "Private", sharedMemory: false });
    useGaps.getState().updateAgent(agent.id, { brainId: brain.id });
    expect(memoryKeyFor(useGaps.getState().findAgent(agent.id)!.agent)).toBe(agent.id);
  });

  it("pools remember/recall across agents wearing a shared-memory brain", async () => {
    const brain = useBrains.getState().createBrain({ name: "Hive", sharedMemory: true });
    const a1 = makeAgent();
    const a2 = makeAgent();
    useGaps.getState().updateAgent(a1.id, { brainId: brain.id });
    useGaps.getState().updateAgent(a2.id, { brainId: brain.id });

    const agent1 = useGaps.getState().findAgent(a1.id)!.agent;
    const agent2 = useGaps.getState().findAgent(a2.id)!.agent;

    // Agent 1 remembers via the memory tool…
    const { executors } = buildTools({ ...agent1, skills: [{ id: "m", name: "Memory", description: "", kind: "memory", enabled: true }] });
    await runTool("remember", { text: "the launch is on Friday" }, executors, { agent: agent1 });

    // …into the brain's shared pool, not its own.
    expect(useMemory.getState().notes[0].agentId).toBe(`brain:${brain.id}`);

    // Agent 2 recalls it from the same pool.
    const out = await runTool("recall", { query: "launch" }, executors, { agent: agent2 });
    expect(out).toContain("the launch is on Friday");
  });
});

describe("brain-aware agent runs", () => {
  it("applies the brain's model override and appends its mind to the system prompt", async () => {
    const brain = useBrains.getState().createBrain({
      name: "Fast mind",
      model: "claude-haiku-4-5",
      temperature: 0.2,
      systemAppend: "Answer in haiku form.",
    });
    const created = makeAgent();
    useGaps.getState().updateAgent(created.id, { brainId: brain.id });
    const agent = useGaps.getState().findAgent(created.id)!.agent;

    const spy = mockStreamingFetch([textTurn("ok")]);
    await runAgentHeadless(agent, "hello");

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.model).toBe("claude-haiku-4-5");
    // Haiku 4.5 predates the 4.7 sampling removal, so temperature still applies.
    expect(body.temperature).toBe(0.2);
    // System is a cacheable block array, not a bare string.
    const system = body.system.map((b: any) => b.text).join("\n");
    expect(system).toContain(agent.systemPrompt);
    expect(system).toContain("Answer in haiku form.");
  });

  it("leaves the agent's own config untouched when no brain is attached", async () => {
    const agent = makeAgent();
    const spy = mockStreamingFetch([textTurn("ok")]);
    await runAgentHeadless(agent, "hello");

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.model).toBe(agent.model);
    // Claude 4.7+ reject an explicit temperature with a 400, so it is dropped
    // for those models even though the agent still carries the setting.
    expect(body.temperature).toBeUndefined();
  });

  it("caches the system prompt so it is not re-billed every turn", async () => {
    const agent = makeAgent();
    const spy = mockStreamingFetch([textTurn("ok")]);
    await runAgentHeadless(agent, "hello");

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});
