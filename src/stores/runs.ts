import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { Run } from "@/types/domain";

interface RunStore {
  runs: Run[];
  startRun: (input: Omit<Run, "id" | "startedAt" | "status" | "tokensIn" | "tokensOut" | "costUsd">) => string;
  finishRun: (
    id: string,
    patch: {
      status: Run["status"];
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      errorKind?: Run["errorKind"];
      summary?: string;
    },
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
          costUsd: 0,
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
    {
      name: "forge.runs",
      version: 2,
      // v1: runs written before cost accounting have no costUsd. Left undefined
      // it crashes fmtUsd in the Runs table and turns every spend total into
      // NaN. v2 added model/runtime/errorKind, which are optional and so need
      // no backfill — old rows simply chart as "unknown".
      migrate: (state: any) => ({
        ...state,
        runs: (state?.runs ?? []).map((r: Run) => ({ ...r, costUsd: r.costUsd ?? 0 })),
      }),
    },
  ),
);
