/** Pairing: how a phone becomes an owner. Codes are short-lived and single-use. */
import type { Channel } from "@/types/domain";
import { useGaps } from "@/stores/gaps";
import { channelKey } from "@/stores/channelRuntime";
import { rt } from "./send";

export const PAIR_TTL_MS = 10 * 60_000;
export const MAX_PAIR_ATTEMPTS = 5;
const PAIR_CODE_SPACE = 1_000_000;

/** Issue a fresh 6-digit pairing code for a channel. */
export function startPairing(host: { id: string }, channel: Channel): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % PAIR_CODE_SPACE;
  const code = String(n).padStart(6, "0");
  rt().setPairing(channelKey(host.id, channel.id), { code, expiresAt: Date.now() + PAIR_TTL_MS, attempts: 0 });
  return code;
}

export function cancelPairing(host: { id: string }, channel: Channel): void {
  rt().setPairing(channelKey(host.id, channel.id), null);
}

/**
 * Check a `/pair` attempt. Codes are single-use, expire, and burn after a few
 * wrong guesses, so a stranger who finds the bot can't brute-force their way in.
 */
export function checkPairCode(key: string, guess: string): "ok" | "wrong" | "none" {
  const p = rt().pairing[key];
  if (!p || p.expiresAt < Date.now()) {
    if (p) rt().setPairing(key, null);
    return "none";
  }
  if (guess === p.code) {
    rt().setPairing(key, null);
    return "ok";
  }
  const attempts = p.attempts + 1;
  rt().setPairing(key, attempts >= MAX_PAIR_ATTEMPTS ? null : { ...p, attempts });
  return "wrong";
}

export function removeOwner(hostId: string, channel: Channel, ownerId: string): void {
  useGaps.getState().upsertChannel(hostId, {
    ...channel,
    owners: (channel.owners ?? []).filter((o) => o.id !== ownerId),
  });
}
