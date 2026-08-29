import { describe, it, expect } from "vitest";
import { useRuns } from "@/stores/runs";
import { fmtUsd } from "@/lib/format";

describe("runs persist migration", () => {
  it("backfills costUsd on runs written before cost accounting", async () => {
    // The shape the shipped 0.1.0 build wrote: version 0, no costUsd.
    localStorage.setItem(
      "forge.runs",
      JSON.stringify({
        state: {
          runs: [
            { id: "a", agentId: "x", agentName: "Old", status: "success", startedAt: 1, endedAt: 2, tokensIn: 10, tokensOut: 20 },
          ],
        },
        version: 0,
      }),
    );

    await useRuns.persist.rehydrate();
    const runs = useRuns.getState().runs;

    expect(runs[0].costUsd).toBe(0);
    expect(fmtUsd(runs.reduce((a, r) => a + r.costUsd, 0))).toBe("$0.00");
  });
});
