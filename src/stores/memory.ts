import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

export interface MemoryNote {
  id: string;
  /** Owner key: an agent id, or `brain:<id>` for a shared brain pool. */
  agentId: string;
  text: string;
  createdAt: number;
  /** Learning queue: pending notes wait for approval and are never recalled. */
  status?: "pending";
  /** Which agent proposed a pending note (for the review UI). */
  proposedBy?: string;
}

interface MemoryStore {
  notes: MemoryNote[];
  remember: (agentId: string, text: string) => MemoryNote;
  /** Queue a fact for review instead of saving it outright. */
  propose: (agentId: string, text: string, proposedBy?: string) => MemoryNote;
  approve: (id: string) => void;
  /** Reject = drop. Alias kept for review-UI readability. */
  reject: (id: string) => void;
  recall: (agentId: string, query: string, limit?: number) => MemoryNote[];
  forAgent: (agentId: string) => MemoryNote[];
  pendingFor: (agentId: string) => MemoryNote[];
  remove: (id: string) => void;
  clearAgent: (agentId: string) => void;
}

export const useMemory = create<MemoryStore>()(
  persist(
    (set, get) => ({
      notes: [],
      remember: (agentId, text) => {
        const note: MemoryNote = { id: nanoid(8), agentId, text: text.trim(), createdAt: Date.now() };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note;
      },
      propose: (agentId, text, proposedBy) => {
        const note: MemoryNote = {
          id: nanoid(8),
          agentId,
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
      recall: (agentId, query, limit = 5) => {
        const q = query.toLowerCase().split(/\s+/).filter(Boolean);
        return get()
          .notes.filter((n) => n.agentId === agentId && n.status !== "pending")
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
      pendingFor: (agentId) =>
        get().notes.filter((n) => n.agentId === agentId && n.status === "pending"),
      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      clearAgent: (agentId) => set((s) => ({ notes: s.notes.filter((n) => n.agentId !== agentId) })),
    }),
    { name: "forge.memory" },
  ),
);
