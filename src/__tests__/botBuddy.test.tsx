import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { BotBuddy } from "@/components/BotBuddy";
import { botColors } from "@/lib/botLook";

const pose = (c: HTMLElement) =>
  [...(c.querySelector("svg.bb")?.classList ?? [])].find((x) => /^bb-(?!all|breathe)/.test(x) && x !== "bb");

afterEach(() => vi.useRealTimers());

describe("BotBuddy", () => {
  it("acts out the mood it's given", () => {
    for (const mood of ["think", "talk", "sleep"] as const) {
      const { container, unmount } = render(<BotBuddy name="Scout" mood={mood} />);
      expect(pose(container)).toBe(`bb-${mood}`);
      unmount();
    }
  });

  it("plays: every action is followed by a rest, so it settles before the next", () => {
    vi.useFakeTimers();
    const { container } = render(<BotBuddy name="Scout" mood="play" />);
    // Record every change over ~40s of play.
    const seen: string[] = [pose(container)!];
    for (let t = 0; t < 40_000; t += 100) {
      act(() => void vi.advanceTimersByTime(100));
      const now = pose(container)!;
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    expect(seen.length).toBeGreaterThan(8);
    seen.forEach((p, i) => expect(p === "bb-rest").toBe(i % 2 === 1));
  });

  it("is the same colour as the agent's face everywhere", () => {
    expect(botColors("Scout")).toEqual(botColors("Scout"));
    expect(botColors("Scout")).not.toEqual(botColors("Writer"));
  });
});
