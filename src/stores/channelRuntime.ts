import { create } from "zustand";

/** In-memory runtime state for live channels (not persisted — bots stop when
 *  the app closes). Keyed by `${agentId}__${channelId}`. */
interface ChannelRuntimeStore {
  running: Record<string, boolean>;
  lastError: Record<string, string>;
  setRunning: (key: string, on: boolean) => void;
  setError: (key: string, err: string) => void;
}

export const useChannelRuntime = create<ChannelRuntimeStore>((set) => ({
  running: {},
  lastError: {},
  setRunning: (key, on) => set((s) => ({ running: { ...s.running, [key]: on } })),
  setError: (key, err) => set((s) => ({ lastError: { ...s.lastError, [key]: err } })),
}));

export const channelKey = (agentId: string, channelId: string) => `${agentId}__${channelId}`;
