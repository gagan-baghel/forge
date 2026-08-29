import { create } from "zustand";
import { currentModel } from "@/types/domain";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { Agent, Brain, KnowledgeDoc } from "@/types/domain";
import { useGaps } from "./gaps";

const now = () => Date.now();

interface BrainStore {
  brains: Brain[];

  createBrain: (input: Partial<Brain> & { name: string }) => Brain;
  updateBrain: (id: string, patch: Partial<Brain>) => void;
  /** Deletes the brain and detaches it from every agent wearing it. */
  deleteBrain: (id: string) => void;

  addKnowledge: (brainId: string, doc: Omit<KnowledgeDoc, "id" | "addedAt">) => void;
  removeKnowledge: (brainId: string, docId: string) => void;

  findBrain: (id: string) => Brain | undefined;
}

export const useBrains = create<BrainStore>()(
  persist(
    (set, get) => ({
      brains: [],

      createBrain: (input) => {
        const brain: Brain = {
          id: nanoid(10),
          name: input.name,
          emoji: input.emoji ?? "🧠",
          description: input.description ?? "",
          version: input.version ?? "1.0.0",
          tags: input.tags ?? [],
          model: input.model,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          systemAppend: input.systemAppend ?? "",
          knowledge: input.knowledge ?? [],
          sharedMemory: input.sharedMemory ?? false,
          reviewLearning: input.reviewLearning ?? false,
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({ brains: [brain, ...s.brains] }));
        return brain;
      },

      updateBrain: (id, patch) =>
        set((s) => ({
          brains: s.brains.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: now() } : b)),
        })),

      deleteBrain: (id) => {
        // Detach from every agent first so no agent points at a dead brain.
        const gapStore = useGaps.getState();
        for (const agent of gapStore.allAgents()) {
          if (agent.brainId === id) gapStore.updateAgent(agent.id, { brainId: undefined });
        }
        set((s) => ({ brains: s.brains.filter((b) => b.id !== id) }));
      },

      addKnowledge: (brainId, doc) => {
        const b = get().findBrain(brainId);
        if (!b) return;
        get().updateBrain(brainId, {
          knowledge: [...b.knowledge, { ...doc, id: nanoid(8), addedAt: now() }],
        });
      },
      removeKnowledge: (brainId, docId) => {
        const b = get().findBrain(brainId);
        if (!b) return;
        get().updateBrain(brainId, { knowledge: b.knowledge.filter((d) => d.id !== docId) });
      },

      findBrain: (id) => get().brains.find((b) => b.id === id),
    }),
    {
      name: "forge.brains",
      version: 1,
      // Brains can pin their own model; migrate those too.
      migrate: (state: any) => ({
        ...state,
        brains: (state?.brains ?? []).map((b: any) => ({ ...b, model: currentModel(b.model) })),
      }),
    },
  ),
);

/** The brain an agent is wearing, if any. */
export function brainFor(agent: Agent): Brain | undefined {
  return agent.brainId ? useBrains.getState().findBrain(agent.brainId) : undefined;
}

/** Agents (across all GAPs) currently wearing the given brain. */
export function agentsWearing(brainId: string): Agent[] {
  return useGaps
    .getState()
    .allAgents()
    .filter((a) => a.brainId === brainId);
}

/**
 * Where the `remember`/`recall` skills store notes for this agent: the shared
 * brain pool when the attached brain opts in, otherwise the agent itself.
 */
export function memoryKeyFor(agent: Agent): string {
  const brain = brainFor(agent);
  return brain?.sharedMemory ? `brain:${brain.id}` : agent.id;
}
