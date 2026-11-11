/**
 * Self-update. Installed copies ask GitHub Releases for `latest.json` (see
 * plugins.updater in tauri.conf.json); when a newer signed build exists the
 * sidebar offers it, and one click downloads, verifies, installs and restarts.
 * Desktop only — the web build has nothing to update.
 */
import { create } from "zustand";
import { isDesktop } from "@/lib/platform";

type Status = "idle" | "checking" | "current" | "available" | "downloading" | "error";

interface UpdateState {
  status: Status;
  /** Version on offer, when one is. */
  version?: string;
  notes?: string;
  /** 0–100 while downloading, when the server sends a size. */
  progress?: number;
  error?: string;
  check: (opts?: { quiet?: boolean }) => Promise<void>;
  install: () => Promise<void>;
}

/** The pending update handle; not state, it holds a native resource. */
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

export const useUpdate = create<UpdateState>((set, get) => ({
  status: "idle",

  check: async ({ quiet = false } = {}) => {
    if (!isDesktop() || get().status === "downloading") return;
    if (!quiet) set({ status: "checking", error: undefined });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pending = update;
        set({ status: "available", version: update.version, notes: update.body, error: undefined });
      } else if (get().status !== "available") {
        set({ status: "current" });
      }
    } catch (e) {
      // Offline or GitHub hiccup: a background check stays silent and tries
      // again later; one the user asked for says what went wrong.
      if (!quiet) set({ status: "error", error: String((e as Error)?.message ?? e) });
    }
  },

  install: async () => {
    if (!pending) return;
    set({ status: "downloading", progress: undefined, error: undefined });
    try {
      let total = 0;
      let done = 0;
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total) set({ progress: Math.min(100, Math.round((done / total) * 100)) });
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "available", error: `Update failed: ${String((e as Error)?.message ?? e)}` });
    }
  },
}));

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Check shortly after launch, then every few hours while Forge stays open. */
export function startUpdateChecks(): () => void {
  if (!isDesktop()) return () => {};
  const first = setTimeout(() => void useUpdate.getState().check({ quiet: true }), 5_000);
  const every = setInterval(() => void useUpdate.getState().check({ quiet: true }), SIX_HOURS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
