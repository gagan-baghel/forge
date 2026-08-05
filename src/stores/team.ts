import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

export type Role = "owner" | "admin" | "member" | "viewer";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  addedAt: number;
}

/**
 * Local workspace roster. Forge is local-first with no auth server, so a "team"
 * here is a local roster you manage for organizing shared GAPs and generating
 * invite codes (which bundle GAPs to hand off). It is not multi-user auth.
 */
interface TeamStore {
  members: Member[];
  add: (input: { name: string; email: string; role: Role }) => Member;
  updateRole: (id: string, role: Role) => void;
  remove: (id: string) => void;
}

export const useTeam = create<TeamStore>()(
  persist(
    (set) => ({
      members: [],
      add: (input) => {
        const m: Member = { ...input, id: nanoid(8), addedAt: Date.now() };
        set((s) => ({ members: [...s.members, m] }));
        return m;
      },
      updateRole: (id, role) => set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, role } : m)) })),
      remove: (id) => set((s) => ({ members: s.members.filter((m) => m.id !== id) })),
    }),
    { name: "forge.team" },
  ),
);
