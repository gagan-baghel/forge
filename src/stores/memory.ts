import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deferredStorage } from "@/lib/persistStorage";
import { nanoid } from "nanoid";

export interface MemoryNote {
  id: string;
  /** The agent this memory belongs to. Empty for a pack memory. */
  agentId: string;
  /** Set for a pack memory: shared by every agent in that pack. */
  gapId?: string;
  text: string;
  createdAt: number;
  /** Learning queue: pending notes wait for approval and are never recalled. */
  status?: "pending";
  /** Which agent proposed a pending note (for the review UI). */
  proposedBy?: string;
}

/** Whose memory: one agent's, or a pack's (shared by its agents). */
export type MemoryOwner = { agentId: string } | { gapId: string };

const ownerFields = (o: MemoryOwner) => ("gapId" in o ? { agentId: "", gapId: o.gapId } : { agentId: o.agentId });

interface MemoryStore {
  notes: MemoryNote[];
  remember: (owner: MemoryOwner, text: string) => MemoryNote;
  /** Queue a fact for review instead of saving it outright. */
  propose: (owner: MemoryOwner, text: string, proposedBy?: string) => MemoryNote;
  approve: (id: string) => void;
  /** Reject = drop. Alias kept for review-UI readability. */
  reject: (id: string) => void;
  /** The agent's own memories and its pack's, most relevant first. */
  recall: (agentId: string, query: string, limit?: number, gapId?: string) => MemoryNote[];
  forAgent: (agentId: string) => MemoryNote[];
  forPack: (gapId: string) => MemoryNote[];
  clearPack: (gapId: string) => void;
  pendingFor: (agentId: string) => MemoryNote[];
  remove: (id: string) => void;
  clearAgent: (agentId: string) => void;
}

export const useMemory = create<MemoryStore>()(
  persist(
    (set, get) => ({
      notes: [],
      remember: (owner, text) => {
        const note: MemoryNote = { id: nanoid(8), ...ownerFields(owner), text: text.trim(), createdAt: Date.now() };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note;
      },
      propose: (owner, text, proposedBy) => {
        const note: MemoryNote = {
          id: nanoid(8),
          ...ownerFields(owner),
          text: text.trim(),
          createdAt: Date.now(),
          status: "pending",
          proposedBy,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note;
      },
      approve: (id) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, status: undefined } : n)),
        })),
      reject: (id) => get().remove(id),
      recall: (agentId, query, limit = 5, gapId) => {
        const q = query.toLowerCase().split(/\s+/).filter(Boolean);
        const mine = (n: MemoryNote) => (n.agentId ? n.agentId === agentId : !!gapId && n.gapId === gapId);
        return get()
          .notes.filter((n) => mine(n) && n.status !== "pending")
          .map((n) => {
            const t = n.text.toLowerCase();
            const score = q.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
            return { n, score };
          })
          .sort((a, b) => b.score - a.score || b.n.createdAt - a.n.createdAt)
          .slice(0, limit)
          .map((x) => x.n);
      },
      forAgent: (agentId) => get().notes.filter((n) => n.agentId === agentId),
      forPack: (gapId) => get().notes.filter((n) => !n.agentId && n.gapId === gapId),
      clearPack: (gapId) => set((s) => ({ notes: s.notes.filter((n) => n.agentId || n.gapId !== gapId) })),
      pendingFor: (agentId) => get().notes.filter((n) => n.agentId === agentId && n.status === "pending"),
      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      clearAgent: (agentId) => set((s) => ({ notes: s.notes.filter((n) => n.agentId !== agentId) })),
    }),
    { name: "forge.memory", storage: deferredStorage() },
  ),
);
