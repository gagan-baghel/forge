import { describe, it, expect } from "vitest";
import { windowHistory } from "@/lib/agentRun";
import type { ChatMessage } from "@/types/domain";

const msg = (role: "user" | "assistant", content: string, i = 0): ChatMessage => ({
  id: `m${i}`,
  role,
  content,
  createdAt: i,
});

/** Turn N used to re-bill turns 1..N-1; the window bounds that. */
describe("history windowing", () => {
  it("keeps a short conversation whole", () => {
    const h = [msg("user", "hi", 1), msg("assistant", "hello", 2), msg("user", "again", 3)];
    expect(windowHistory(h)).toHaveLength(3);
  });

  it("drops the oldest turns once the budget is exceeded", () => {
    const h = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(400), i),
    );
    // 40 × 400 chars = 16k chars; a 1k-token (4k-char) budget must trim.
    const kept = windowHistory(h, 1_000);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(h.length);
    // The newest turn always survives.
    expect(kept[kept.length - 1]).toEqual(h[h.length - 1]);
  });

  it("always opens on a user turn — the API rejects anything else", () => {
    // Real histories end on the user's newest message.
    const h = Array.from({ length: 21 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", "y".repeat(500), i),
    );
    for (const budget of [200, 500, 1_000, 2_000, 100_000]) {
      const kept = windowHistory(h, budget);
      expect(kept.length, `budget ${budget}`).toBeGreaterThan(0);
      expect(kept[0].role, `budget ${budget}`).toBe("user");
    }
  });

  it("never returns a window opening on an assistant turn, even for odd input", () => {
    const h = [msg("assistant", "orphaned reply", 1)];
    expect(windowHistory(h)).toEqual([]);
  });

  it("keeps the newest message even when it alone blows the budget", () => {
    const h = [msg("user", "z".repeat(100_000), 1)];
    expect(windowHistory(h, 10)).toHaveLength(1);
  });

  it("handles an empty history without throwing", () => {
    expect(windowHistory([])).toEqual([]);
  });
});
