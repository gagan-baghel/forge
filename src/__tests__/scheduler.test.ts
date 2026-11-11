import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetStores } from "@/test/reset";
import { useRoutines } from "@/stores/routines";

const runAgentHeadless = vi.hoisted(() => vi.fn(async () => ({ text: "ok", inputTokens: 0, outputTokens: 0, costUsd: 0 })));
vi.mock("@/lib/agentRun", () => ({ runAgentHeadless }));
vi.mock("@/lib/runner", () => ({ recordRun: (_a: unknown, _k: unknown, fn: () => Promise<unknown>) => fn() }));

import { tick, resetScheduler } from "@/lib/scheduler";
import { useGaps } from "@/stores/gaps";

const at = (h: number, m: number) => new Date(2026, 5, 20, h, m, 10);

beforeEach(() => {
  resetStores();
  resetScheduler();
  runAgentHeadless.mockClear();
  const gap = useGaps.getState().createGap({ name: "G", description: "" });
  const agent = useGaps.getState().addAgent(gap.id, { name: "A", role: "r" });
  useRoutines.getState().add({ name: "R", agentId: agent.id, agentName: "A", cron: "0 9 * * *", prompt: "p", enabled: true });
});

describe("scheduler tick", () => {
  it("catches a minute that a throttled timer skipped", async () => {
    tick(at(8, 59));
    tick(at(9, 2)); // 9:00 fell between ticks
    await vi.waitFor(() => expect(runAgentHeadless).toHaveBeenCalledTimes(1));
  });

  it("fires once even when ticks land twice in the same minute", async () => {
    tick(at(8, 59));
    tick(at(9, 0));
    tick(new Date(2026, 5, 20, 9, 0, 40));
    await vi.waitFor(() => expect(runAgentHeadless).toHaveBeenCalledTimes(1));
  });

  it("doesn't fire for minutes before the app opened", () => {
    tick(at(9, 3));
    expect(runAgentHeadless).not.toHaveBeenCalled();
  });
});
