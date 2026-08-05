import { describe, it, expect, beforeEach } from "vitest";
import { resetStores } from "@/test/reset";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useMemory } from "@/stores/memory";
import { marketplaceCatalog } from "@/lib/seed";

beforeEach(() => resetStores());

describe("gaps store", () => {
  it("creates a GAP and adds an agent", () => {
    const gap = useGaps.getState().createGap({ name: "My Pack", description: "d" });
    expect(useGaps.getState().gaps).toHaveLength(1);
    const agent = useGaps.getState().addAgent(gap.id, { name: "Bot", role: "Helper" });
    expect(useGaps.getState().findAgent(agent.id)?.agent.name).toBe("Bot");
    expect(useGaps.getState().findGap(gap.id)?.agents).toHaveLength(1);
  });

  it("installs a marketplace listing with fresh ids", () => {
    const listing = marketplaceCatalog()[0];
    const installed = useGaps.getState().installListing(listing);
    expect(installed.installed).toBe(true);
    expect(installed.source).toBe("marketplace");
    expect(installed.agents[0].gapId).toBe(installed.id);
  });

  it("toggles a skill and manages knowledge", () => {
    const gap = useGaps.getState().createGap({ name: "P", description: "" });
    const agent = useGaps.getState().addAgent(gap.id, { name: "B", role: "r" });
    useGaps.getState().addSkill(agent.id, { name: "HTTP", kind: "http", description: "", enabled: true });
    const skillId = useGaps.getState().findAgent(agent.id)!.agent.skills[0].id;
    useGaps.getState().toggleSkill(agent.id, skillId);
    expect(useGaps.getState().findAgent(agent.id)!.agent.skills[0].enabled).toBe(false);

    useGaps.getState().addKnowledge(agent.id, { title: "Doc", content: "text", bytes: 4 });
    expect(useGaps.getState().findAgent(agent.id)!.agent.knowledge).toHaveLength(1);
  });

  it("deletes a GAP and its agents", () => {
    const gap = useGaps.getState().createGap({ name: "P", description: "" });
    useGaps.getState().deleteGap(gap.id);
    expect(useGaps.getState().gaps).toHaveLength(0);
  });
});

describe("conversations store", () => {
  it("reuses one conversation per agent and titles from first message", () => {
    const id = useConversations.getState().ensureConversation("agent-1");
    expect(useConversations.getState().ensureConversation("agent-1")).toBe(id);
    useConversations.getState().appendMessage(id, { id: "m1", role: "user", content: "Hello world question", createdAt: 0 });
    expect(useConversations.getState().get(id)?.title).toBe("Hello world question");
  });
});

describe("memory store", () => {
  it("remembers and recalls relevant notes", () => {
    useMemory.getState().remember("a1", "The launch date is in October");
    useMemory.getState().remember("a1", "The mascot is a fox");
    const hits = useMemory.getState().recall("a1", "when is launch");
    expect(hits[0].text).toMatch(/launch date/);
  });
});
