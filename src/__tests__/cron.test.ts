import { describe, it, expect } from "vitest";
import { cronMatches, isValidCron, nextRun } from "@/lib/cron";

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

describe("cron edge cases", () => {
  const at = (d: number, h = 9, m = 0) => new Date(2026, 5, d, h, m); // June 2026: the 21st is a Sunday

  it("never hangs on a zero or negative step, and calls it invalid", () => {
    expect(isValidCron("*/0 * * * *")).toBe(false);
    expect(isValidCron("*/-1 * * * *")).toBe(false);
    expect(cronMatches("*/-1 * * * *", at(20))).toBe(false);
  });

  it("treats 7 as Sunday", () => {
    expect(cronMatches("0 9 * * 7", at(21))).toBe(true);
    expect(cronMatches("0 9 * * 5-7", at(21))).toBe(true);
  });

  it("reads a/n as 'from a, every n'", () => {
    expect(cronMatches("5/15 * * * *", at(20, 9, 20))).toBe(true);
    expect(cronMatches("5/15 * * * *", at(20, 9, 21))).toBe(false);
  });

  it("ORs day-of-month and day-of-week when both are set", () => {
    expect(cronMatches("0 9 1 * 1", at(1))).toBe(true); // the 1st (a Monday)
    expect(cronMatches("0 9 1 * 1", at(8))).toBe(true); // a Monday
    expect(cronMatches("0 9 1 * 1", at(9))).toBe(false); // neither
  });

  it("rejects out-of-range and junk values", () => {
    for (const bad of ["60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "a * * * *", "5-1 * * * *"]) {
      expect(isValidCron(bad), bad).toBe(false);
    }
  });

  it("finds a monthly next run more than two weeks out", () => {
    const next = nextRun("0 9 1 * *", new Date(2026, 5, 2, 0, 0));
    expect(new Date(next!).getMonth()).toBe(6); // July 1st
  });
});
