/**
 * Storage for every persisted store: writes are coalesced instead of hitting
 * localStorage on each change.
 *
 * zustand's default persistence serialises the whole store and writes it
 * synchronously on every `set`. A streaming reply sets the conversation store
 * once per token, so a long chat history was re-stringified and re-written
 * dozens of times a second on the UI thread. Here the latest state is kept in
 * memory and written once things go quiet, and immediately when the window is
 * hidden or closed, so nothing is lost on quit.
 */
import type { PersistStorage, StorageValue } from "zustand/middleware";

/** Quiet period before a write; short enough that a crash loses almost nothing. */
const WRITE_DELAY_MS = 400;

const pending = new Map<string, StorageValue<unknown>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let suspended = false;

/** Write everything pending now. */
export function flushPendingWrites(): void {
  clearTimeout(timer);
  timer = undefined;
  if (suspended) return;
  for (const [name, value] of pending) {
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      // Quota or a locked store: the in-memory state still works this session.
    }
  }
  pending.clear();
}

/**
 * Drop pending writes and stop writing for the rest of this page. Called by
 * "clear all data" and backup restore right before they reload, so a pending
 * write can't put old state back on top of what they just did.
 */
export function discardPendingWrites(): void {
  clearTimeout(timer);
  pending.clear();
  suspended = true;
}

/** Tests only: forget queued writes and resume writing, like a fresh launch. */
export function resetPendingWrites(): void {
  clearTimeout(timer);
  pending.clear();
  suspended = false;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flushPendingWrites, WRITE_DELAY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingWrites);
  window.addEventListener("beforeunload", flushPendingWrites);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingWrites();
  });
}

/** The `storage` option for `persist(...)`. */
export function deferredStorage<S>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      const queued = pending.get(name);
      if (queued) return queued as StorageValue<S>;
      const raw = localStorage.getItem(name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (suspended) return;
      pending.set(name, value);
      schedule();
    },
    removeItem: (name) => {
      pending.delete(name);
      localStorage.removeItem(name);
    },
  };
}
