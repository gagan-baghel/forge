import { describe, it, expect } from "vitest";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { MODELS } from "@/types/domain";
import { costFor } from "@/lib/claude";

/**
 * Agents and settings saved before the Claude 5 rename carry retired
 * model ids. Left alone the runs still succeed, so the breakage is silent:
 * every run prices at $0 and the model picker has nothing selected.
 */
describe("model id migration", () => {
  it("migrates a saved agent off the retired Opus id", async () => {
    localStorage.setItem(
      "forge.gaps",
      JSON.stringify({
        state: {
          seeded: true,
          gaps: [{ id: "g", name: "Pack", agents: [{ id: "a", name: "Ledger", model: "claude-opus-4-8" }] }],
        },
        version: 0,
      }),
    );

    await useGaps.persist.rehydrate();

    expect(useGaps.getState().gaps[0].agents[0].model).toBe("claude-opus-5-5");
  });

  it("migrates the workspace default model", async () => {
    localStorage.setItem(
      "forge.settings",
      JSON.stringify({ state: { defaultModel: "claude-opus-4-8" }, version: 0 }),
    );

    await useSettings.persist.rehydrate();

    expect(useSettings.getState().defaultModel).toBe("claude-opus-5-5");
  });

  it("prices every catalogue model — a missing entry silently bills $0", () => {
    for (const m of MODELS) {
      expect(costFor(m.id, 1_000_000, 0), `${m.id} has no price`).toBeGreaterThan(0);
    }
  });
});
