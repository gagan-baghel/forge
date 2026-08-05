import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { Routine } from "@/types/domain";

interface RoutineStore {
  routines: Routine[];
  add: (input: Omit<Routine, "id">) => Routine;
  update: (id: string, patch: Partial<Routine>) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
}

export const useRoutines = create<RoutineStore>()(
  persist(
    (set, get) => ({
      routines: [],
      add: (input) => {
        const routine: Routine = { ...input, id: nanoid(10) };
        set((s) => ({ routines: [routine, ...s.routines] }));
        return routine;
      },
      update: (id, patch) =>
        set((s) => ({ routines: s.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      remove: (id) => set((s) => ({ routines: s.routines.filter((r) => r.id !== id) })),
      toggle: (id) => {
        const r = get().routines.find((x) => x.id === id);
        if (r) get().update(id, { enabled: !r.enabled });
      },
    }),
    { name: "forge.routines" },
  ),
);
