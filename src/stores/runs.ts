import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { Run } from "@/types/domain";

interface RunStore {
  runs: Run[];
  startRun: (input: Omit<Run, "id" | "startedAt" | "status" | "tokensIn" | "tokensOut">) => string;
  finishRun: (
    id: string,
    patch: { status: Run["status"]; tokensIn: number; tokensOut: number; summary?: string },
  ) => void;
  clear: () => void;
}

export const useRuns = create<RunStore>()(
  persist(
    (set) => ({
      runs: [],
      startRun: (input) => {
        const id = nanoid(10);
        const run: Run = {
          ...input,
          id,
          status: "running",
          startedAt: Date.now(),
          tokensIn: 0,
          tokensOut: 0,
        };
        set((s) => ({ runs: [run, ...s.runs].slice(0, 500) }));
        return id;
      },
      finishRun: (id, patch) =>
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === id ? { ...r, ...patch, endedAt: Date.now() } : r,
          ),
        })),
      clear: () => set({ runs: [] }),
    }),
    { name: "forge.runs" },
  ),
);
