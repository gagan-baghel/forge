import { describe, it, expect, beforeEach } from "vitest";
import { recordRun } from "@/lib/runner";
import { useRuns } from "@/stores/runs";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { resetStores } from "@/test/reset";
import { MODELS } from "@/types/domain";
import { costFor } from "@/lib/claude";
import type { AgentTurnResult } from "@/lib/agentRun";

const result = (over: Partial<AgentTurnResult> = {}): AgentTurnResult => ({
  text: "done",
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.001,
  ...over,
});

function agent() {
  const gap = useGaps.getState().createGap({ name: "P", description: "" });
  return useGaps.getState().addAgent(gap.id, { name: "A", role: "r" });
}

beforeEach(() => {
  resetStores();
  useSettings.setState({ runtime: "api" });
});

/**
 * Every trigger records the same fields. This used to be three hand-written
 * copies, and two of them omitted model/runtime — so spend-by-model silently
 * covered chat only.
 */
describe("run recording", () => {
  it.each(["chat", "channel", "schedule", "manual"] as const)(
    "records model and runtime for a %s run",
    async (trigger) => {
      const a = agent();
      await recordRun(a, trigger, async () => result());

      const run = useRuns.getState().runs[0];
      expect(run.trigger).toBe(trigger);
      expect(run.model).toBe(a.model);
      expect(run.runtime).toBe("api");
      expect(run.status).toBe("success");
      expect(run.costUsd).toBe(0.001);
    },
  );

  it("classifies a failure and re-throws so the caller can still react", async () => {
    const a = agent();
    await expect(
      recordRun(a, "chat", async () => {
        throw new Error("Claude API error 429: rate_limit_error");
      }),
    ).rejects.toThrow(/429/);

    const run = useRuns.getState().runs[0];
    expect(run.status).toBe("error");
    expect(run.errorKind).toBe("rate_limit");
  });

  it("treats a user cancel as cancelled, not a failure", async () => {
    const a = agent();
    await expect(
      recordRun(a, "chat", async () => {
        throw Object.assign(new Error("Stopped."), { name: "AbortError" });
      }),
    ).rejects.toThrow();

    const run = useRuns.getState().runs[0];
    expect(run.status).toBe("cancelled");
    // A deliberate stop is not an error kind — it would pollute the failure mix.
    expect(run.errorKind).toBeUndefined();
  });

  it("lets a caller supply its own log summary", async () => {
    const a = agent();
    await recordRun(a, "schedule", async () => result(), { summary: () => "⏰ nightly digest" });
    expect(useRuns.getState().runs[0].summary).toBe("⏰ nightly digest");
  });
});

/** The registry is the single source of truth; nothing may be missing from it. */
describe("model registry", () => {
  it("prices every catalogue model", () => {
    for (const m of MODELS) {
      expect(costFor(m.id, 1_000_000, 0), m.id).toBeGreaterThan(0);
    }
  });

  it("gives every model a complete spec", () => {
    for (const m of MODELS) {
      expect(m.label, m.id).toBeTruthy();
      expect(m.blurb, m.id).toBeTruthy();
      expect(m.price.in, m.id).toBeGreaterThan(0);
      expect(m.price.out, m.id).toBeGreaterThan(0);
      expect(typeof m.sampling, m.id).toBe("boolean");
      expect(typeof m.adaptiveThinking, m.id).toBe("boolean");
      expect(m.webSearch, m.id).toMatch(/^web_search_\d+$/);
    }
  });

  it("never claims both adaptive thinking and sampling — the API rejects that pair", () => {
    for (const m of MODELS) {
      expect(m.adaptiveThinking && m.sampling, m.id).toBe(false);
    }
  });
});
