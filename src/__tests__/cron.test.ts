import { describe, it, expect } from "vitest";
import { cronMatches, nextRun } from "@/lib/cron";

describe("cron matcher", () => {
  it("matches a specific minute/hour", () => {
    const d = new Date(2026, 5, 20, 9, 0, 0); // 09:00
    expect(cronMatches("0 9 * * *", d)).toBe(true);
    expect(cronMatches("0 10 * * *", d)).toBe(false);
  });

  it("supports wildcards", () => {
    const d = new Date(2026, 5, 20, 14, 37);
    expect(cronMatches("* * * * *", d)).toBe(true);
  });

  it("supports ranges and steps", () => {
    const weekday = new Date(2026, 5, 22, 8, 0); // Mon 08:00
    expect(cronMatches("0 8 * * 1-5", weekday)).toBe(true);
    const sunday = new Date(2026, 5, 21, 8, 0);
    expect(cronMatches("0 8 * * 1-5", sunday)).toBe(false);
    expect(cronMatches("*/15 * * * *", new Date(2026, 5, 20, 0, 30))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date(2026, 5, 20, 0, 31))).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(cronMatches("not a cron", new Date())).toBe(false);
    expect(cronMatches("0 9 * *", new Date())).toBe(false);
  });

  it("computes a future next-run", () => {
    const from = new Date(2026, 5, 20, 8, 0, 0);
    const next = nextRun("0 9 * * *", from);
    expect(next).toBeGreaterThan(from.getTime());
    expect(new Date(next!).getHours()).toBe(9);
  });
});
