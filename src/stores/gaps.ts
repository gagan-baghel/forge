import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { currentModel } from "@/types/domain";
import type {
  Agent,
  Connector,
  Channel,
  Gap,
  KnowledgeDoc,
  MarketplaceListing,
  Skill,
} from "@/types/domain";
import { starterGaps } from "@/lib/seed";

const now = () => Date.now();

interface GapStore {
  gaps: Gap[];
  seeded: boolean;

  // GAP lifecycle
  createGap: (input: { name: string; description: string; emoji?: string; color?: string; tags?: string[] }) => Gap;
  updateGap: (id: string, patch: Partial<Gap>) => void;
  deleteGap: (id: string) => void;
  installListing: (listing: MarketplaceListing) => Gap;
  importGap: (gap: Gap) => Gap;

  // Agent lifecycle
  addAgent: (gapId: string, input: Partial<Agent> & { name: string; role: string }) => Agent;
  updateAgent: (agentId: string, patch: Partial<Agent>) => void;
  deleteAgent: (agentId: string) => void;

  // Nested editors
  addSkill: (agentId: string, skill: Omit<Skill, "id">) => void;
  toggleSkill: (agentId: string, skillId: string) => void;
  removeSkill: (agentId: string, skillId: string) => void;
  addKnowledge: (agentId: string, doc: Omit<KnowledgeDoc, "id" | "addedAt">) => void;
  removeKnowledge: (agentId: string, docId: string) => void;
  addConnector: (agentId: string, connector: Omit<Connector, "id">) => void;
  removeConnector: (agentId: string, connectorId: string) => void;
  upsertChannel: (agentId: string, channel: Channel) => void;
  removeChannel: (agentId: string, channelId: string) => void;

  // Selectors
  findGap: (id: string) => Gap | undefined;
  findAgent: (id: string) => { gap: Gap; agent: Agent } | undefined;
  allAgents: () => Agent[];
}

function touch<T extends { updatedAt: number }>(o: T): T {
  return { ...o, updatedAt: now() };
}

export const useGaps = create<GapStore>()(
  persist(
    (set, get) => ({
      gaps: [],
      seeded: false,

      createGap: (input) => {
        const id = nanoid(10);
        const gap: Gap = {
          id,
          slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id,
          name: input.name,
          description: input.description,
          emoji: input.emoji ?? "📦",
          color: input.color ?? "#6D5BFF",
          tags: input.tags ?? [],
          author: "you",
          version: "1.0.0",
          source: "local",
          installed: true,
          agents: [],
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({ gaps: [gap, ...s.gaps] }));
        return gap;
      },

      updateGap: (id, patch) =>
        set((s) => ({ gaps: s.gaps.map((g) => (g.id === id ? touch({ ...g, ...patch }) : g)) })),

      deleteGap: (id) => set((s) => ({ gaps: s.gaps.filter((g) => g.id !== id) })),

      installListing: (listing) => {
        const base = listing.gap as unknown as Gap;
        const id = nanoid(10);
        const gap: Gap = {
          ...base,
          id,
          source: "marketplace",
          installed: true,
          createdAt: now(),
          updatedAt: now(),
          agents: base.agents.map((a) => ({ ...a, id: nanoid(10), gapId: id })),
        };
        set((s) => ({ gaps: [gap, ...s.gaps] }));
        return gap;
      },

      importGap: (incoming) => {
        const id = nanoid(10);
        const gap: Gap = {
          ...incoming,
          id,
          source: "imported",
          installed: true,
          updatedAt: now(),
          agents: incoming.agents.map((a) => ({ ...a, id: nanoid(10), gapId: id })),
        };
        set((s) => ({ gaps: [gap, ...s.gaps] }));
        return gap;
      },

      addAgent: (gapId, input) => {
        const agent: Agent = {
          id: nanoid(10),
          gapId,
          name: input.name,
          role: input.role,
          emoji: input.emoji ?? "🤖",
          systemPrompt: input.systemPrompt ?? "You are a helpful assistant.",
          model: input.model ?? "claude-opus-5",
          temperature: input.temperature ?? 0.7,
          maxTokens: input.maxTokens ?? 2048,
          status: input.status ?? "draft",
          skills: input.skills ?? [],
          knowledge: input.knowledge ?? [],
          connectors: input.connectors ?? [],
          channels: input.channels ?? [],
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({
          gaps: s.gaps.map((g) =>
            g.id === gapId ? touch({ ...g, agents: [...g.agents, agent] }) : g,
          ),
        }));
        return agent;
      },

      updateAgent: (agentId, patch) =>
        set((s) => ({
          gaps: s.gaps.map((g) => ({
            ...g,
            agents: g.agents.map((a) => (a.id === agentId ? touch({ ...a, ...patch }) : a)),
          })),
        })),

      deleteAgent: (agentId) =>
        set((s) => ({
          gaps: s.gaps.map((g) => ({ ...g, agents: g.agents.filter((a) => a.id !== agentId) })),
        })),

      addSkill: (agentId, skill) =>
        get().updateAgent(agentId, {
          skills: [...(get().findAgent(agentId)?.agent.skills ?? []), { ...skill, id: nanoid(8) }],
        }),
      toggleSkill: (agentId, skillId) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, {
          skills: a.skills.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s)),
        });
      },
      removeSkill: (agentId, skillId) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, { skills: a.skills.filter((s) => s.id !== skillId) });
      },

      addKnowledge: (agentId, doc) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, {
          knowledge: [...a.knowledge, { ...doc, id: nanoid(8), addedAt: now() }],
        });
      },
      removeKnowledge: (agentId, docId) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, { knowledge: a.knowledge.filter((d) => d.id !== docId) });
      },

      addConnector: (agentId, connector) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, { connectors: [...a.connectors, { ...connector, id: nanoid(8) }] });
      },
      removeConnector: (agentId, connectorId) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, { connectors: a.connectors.filter((c) => c.id !== connectorId) });
      },

      upsertChannel: (agentId, channel) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        const exists = a.channels.some((c) => c.id === channel.id);
        get().updateAgent(agentId, {
          channels: exists
            ? a.channels.map((c) => (c.id === channel.id ? channel : c))
            : [...a.channels, channel],
        });
      },
      removeChannel: (agentId, channelId) => {
        const a = get().findAgent(agentId)?.agent;
        if (!a) return;
        get().updateAgent(agentId, { channels: a.channels.filter((c) => c.id !== channelId) });
      },

      findGap: (id) => get().gaps.find((g) => g.id === id),
      findAgent: (id) => {
        for (const gap of get().gaps) {
          const agent = gap.agents.find((a) => a.id === id);
          if (agent) return { gap, agent };
        }
        return undefined;
      },
      allAgents: () => get().gaps.flatMap((g) => g.agents),
    }),
    {
      name: "forge.gaps",
      version: 1,
      // Agents saved before the Claude 5 rename still point at retired ids.
      migrate: (state: any) => ({
        ...state,
        gaps: (state?.gaps ?? []).map((g: any) => ({
          ...g,
          agents: (g.agents ?? []).map((a: any) => ({ ...a, model: currentModel(a.model) })),
        })),
      }),
      onRehydrateStorage: () => (state) => {
        // First run: install starter GAPs once.
        if (state && !state.seeded && state.gaps.length === 0) {
          state.gaps = starterGaps();
          state.seeded = true;
        }
      },
    },
  ),
);
