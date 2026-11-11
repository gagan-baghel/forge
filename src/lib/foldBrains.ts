/**
 * One-time migration: Brains are gone. A brain was a second copy of an agent's
 * settings (model, prompt, knowledge, memory) that silently overrode the
 * agent's own, so "which model / what does it know" had two answers. Each
 * brain is folded into every agent that wore it, so behaviour is unchanged,
 * and its stored data is removed.
 */
import { nanoid } from "nanoid";
import { currentModel, type Agent } from "@/types/domain";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";

const KEY = "forge.brains";

interface LegacyBrain {
  id: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemAppend?: string;
  knowledge?: Agent["knowledge"];
  sharedMemory?: boolean;
  reviewLearning?: boolean;
}

/** Returns how many agents were changed. Safe to call on every launch. */
export function foldBrainsIntoAgents(storage: Storage = localStorage): number {
  const raw = storage.getItem(KEY);
  if (raw === null) return 0;
  let brains: LegacyBrain[] = [];
  try {
    brains = JSON.parse(raw)?.state?.brains ?? [];
  } catch {
    // Unreadable: nothing can be recovered from it.
  }
  const byId = new Map(brains.map((b) => [b.id, b]));
  const wearers = new Map<string, string[]>();
  const gaps = useGaps.getState();
  let changed = 0;

  for (const agent of gaps.allAgents() as (Agent & { brainId?: string })[]) {
    if (!agent.brainId) continue;
    const brain = byId.get(agent.brainId);
    const patch: Partial<Agent> & { brainId?: undefined } = { brainId: undefined };
    if (brain) {
      wearers.set(brain.id, [...(wearers.get(brain.id) ?? []), agent.id]);
      if (brain.model) patch.model = currentModel(brain.model) as Agent["model"];
      if (brain.temperature !== undefined) patch.temperature = brain.temperature;
      if (brain.maxTokens !== undefined) patch.maxTokens = brain.maxTokens;
      if (brain.systemAppend?.trim()) patch.systemPrompt = `${agent.systemPrompt}\n\n${brain.systemAppend.trim()}`;
      // Fresh ids: the same brain document now lives on several agents.
      if (brain.knowledge?.length) patch.knowledge = [...agent.knowledge, ...brain.knowledge.map((d) => ({ ...d, id: nanoid(8) }))];
      if (brain.reviewLearning) patch.reviewMemory = true;
    }
    gaps.updateAgent(agent.id, patch);
    changed++;
  }

  // A shared pool becomes a copy on each agent that wore the brain. With no
  // wearers left the notes stay, listed under "removed agent" for cleanup.
  const memory = useMemory.getState();
  for (const [brainId, agentIds] of wearers) {
    const pool = memory.notes.filter((n) => n.agentId === `brain:${brainId}`);
    if (!pool.length) continue;
    const copies = agentIds.flatMap((agentId) => pool.map((n) => ({ ...n, id: nanoid(8), agentId })));
    useMemory.setState((s) => ({ notes: [...copies, ...s.notes.filter((n) => n.agentId !== `brain:${brainId}`)] }));
  }

  storage.removeItem(KEY);
  return changed;
}
