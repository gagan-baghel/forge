import { create } from "zustand";

/**
 * In-memory runtime state for live channels. Not persisted: bots stop when the
 * app quits, and pairing codes, trust windows and pending approvals must not
 * survive a restart. Keyed by `${agentId}__${channelId}` (see channelKey).
 */

export interface PairingCode {
  code: string;
  expiresAt: number;
  /** Wrong guesses so far; the code is burned after MAX_PAIR_ATTEMPTS. */
  attempts: number;
}

/** An approval waiting on the owner's phone, mirrored here for the Remote view. */
export interface PendingRemoteApproval {
  id: string;
  key: string;
  chatId: string;
  title: string;
  body: string;
  createdAt: number;
}

export interface RemoteActivity {
  at: number;
  key: string;
  kind: "in" | "out" | "approval" | "security" | "system";
  text: string;
}

interface ChannelRuntimeStore {
  running: Record<string, boolean>;
  lastError: Record<string, string>;
  /** Bot handle per channel, learned when it starts (e.g. "forge_scout_bot"). */
  botName: Record<string, string>;
  pairing: Record<string, PairingCode>;
  /** `${key}:${chatId}` → epoch ms until which actions run without asking. */
  trustUntil: Record<string, number>;
  /** `${key}:${chatId}` → a run is in flight for that chat. */
  busy: Record<string, boolean>;
  approvals: PendingRemoteApproval[];
  activity: RemoteActivity[];
  setRunning: (key: string, on: boolean) => void;
  setError: (key: string, err: string) => void;
  setBotName: (key: string, name: string) => void;
  setPairing: (key: string, code: PairingCode | null) => void;
  setTrust: (chatKey: string, until: number | null) => void;
  setBusy: (chatKey: string, on: boolean) => void;
  addApproval: (a: PendingRemoteApproval) => void;
  removeApproval: (id: string) => void;
  log: (key: string, kind: RemoteActivity["kind"], text: string) => void;
}

const ACTIVITY_CAP = 200;

const without = <T,>(rec: Record<string, T>, key: string) => {
  const next = { ...rec };
  delete next[key];
  return next;
};

export const useChannelRuntime = create<ChannelRuntimeStore>((set) => ({
  running: {},
  lastError: {},
  botName: {},
  pairing: {},
  trustUntil: {},
  busy: {},
  approvals: [],
  activity: [],
  setRunning: (key, on) => set((s) => ({ running: { ...s.running, [key]: on } })),
  setError: (key, err) => set((s) => ({ lastError: { ...s.lastError, [key]: err } })),
  setBotName: (key, name) => set((s) => ({ botName: { ...s.botName, [key]: name } })),
  setPairing: (key, code) => set((s) => ({ pairing: code ? { ...s.pairing, [key]: code } : without(s.pairing, key) })),
  setTrust: (chatKey, until) =>
    set((s) => ({ trustUntil: until ? { ...s.trustUntil, [chatKey]: until } : without(s.trustUntil, chatKey) })),
  setBusy: (chatKey, on) => set((s) => ({ busy: on ? { ...s.busy, [chatKey]: true } : without(s.busy, chatKey) })),
  addApproval: (a) => set((s) => ({ approvals: [...s.approvals, a] })),
  removeApproval: (id) => set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),
  log: (key, kind, text) =>
    set((s) => ({ activity: [{ at: Date.now(), key, kind, text }, ...s.activity].slice(0, ACTIVITY_CAP) })),
}));

export const channelKey = (agentId: string, channelId: string) => `${agentId}__${channelId}`;
