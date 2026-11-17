import { describe, it, expect, vi, afterEach } from "vitest";
import { deferredStorage, discardPendingWrites, flushPendingWrites } from "@/lib/persistStorage";

const storage = deferredStorage<{ n: number }>();
const value = (n: number) => ({ state: { n }, version: 0 });

afterEach(() => vi.useRealTimers());

describe("deferredStorage", () => {
  it("coalesces a burst of writes into one localStorage write", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    for (let i = 0; i < 1000; i++) storage.setItem("k", value(i));
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("k")!).state.n).toBe(999);
  });

  it("reads back a write that hasn't reached localStorage yet", () => {
    storage.setItem("k", value(7));
    expect(localStorage.getItem("k")).toBeNull();
    expect(storage.getItem("k")).toEqual(value(7));
  });

  it("writes immediately when the window is hidden or closed", () => {
    storage.setItem("k", value(1));
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem("k")!).state.n).toBe(1);
  });

  it("after a discard (clear data, restore), nothing queued or later can overwrite storage", () => {
    storage.setItem("k", value(1));
    discardPendingWrites();
    localStorage.setItem("k", "restored");
    storage.setItem("k", value(2));
    flushPendingWrites();
    expect(localStorage.getItem("k")).toBe("restored");
  });
});
