/**
 * Activity, the way the user thinks of it: one row per thing they asked.
 * A message in a pack chat can run several agents (the one that answered and
 * any teammate it asked); those runs share `Run.group` and fold into a single
 * pack entry. An agent run on its own stays a row of its own.
 */
import type { Run } from "@/types/domain";

export interface PackEntry {
  kind: "pack";
  id: string;
  gapId: string;
  /** Oldest first: the agent that answered, then the teammates it asked. */
  runs: Run[];
  status: Run["status"];
  startedAt: number;
  endedAt?: number;
  tokens: number;
  costUsd: number;
  summary?: string;
}

export type ActivityEntry = { kind: "run"; run: Run } | PackEntry;

/** Worst first: anything still running or failed is what the row should say. */
function combined(runs: Run[]): Run["status"] {
  for (const s of ["running", "error", "cancelled"] as const) if (runs.some((r) => r.status === s)) return s;
  return "success";
}

function packEntry(id: string, members: Run[]): PackEntry {
  const runs = [...members].sort((a, b) => a.startedAt - b.startedAt);
  return {
    kind: "pack",
    id,
    gapId: runs[0].gapId,
    runs,
    status: combined(runs),
    startedAt: runs[0].startedAt,
    endedAt: runs.every((r) => r.endedAt) ? Math.max(...runs.map((r) => r.endedAt ?? 0)) : undefined,
    tokens: runs.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0),
    costUsd: runs.reduce((n, r) => n + r.costUsd, 0),
    summary: runs[0].summary,
  };
}

/** Fold `runs` (newest first, as stored) into activity entries, newest first. */
export function groupRuns(runs: Run[]): ActivityEntry[] {
  const order: (Run | string)[] = [];
  const members = new Map<string, Run[]>();
  for (const run of runs) {
    if (!run.group) order.push(run);
    else if (members.has(run.group)) members.get(run.group)!.push(run);
    else {
      members.set(run.group, [run]);
      order.push(run.group);
    }
  }
  return order.map((x) => (typeof x === "string" ? packEntry(x, members.get(x)!) : { kind: "run", run: x }));
}
