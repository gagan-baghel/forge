/**
 * Routine scheduler. Ticks once a minute while the app is open, fires any due
 * routines through the agent engine, and records each as a run. Local-first:
 * routines run when Forge is running (no cloud cron).
 */

import { cronMatches, nextRun } from "./cron";
import { runAgentHeadless } from "./agentRun";
import { recordRun } from "./runner";
import { discordSend, ownerChannelRef, sendText } from "./channelRuntime";
import { isDesktop } from "./platform";
import type { Agent } from "@/types/domain";
import { useRoutines } from "@/stores/routines";
import { useGaps } from "@/stores/gaps";

/** Deliver routine output to a Discord webhook if the agent has one. */
async function deliverToDiscord(agent: Agent, text: string) {
  if (!isDesktop()) return;
  const discord = agent.channels.find((c) => c.kind === "discord")?.config?.webhook;
  if (discord) {
    try {
      await discordSend(discord, text);
    } catch {
      /* best effort */
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Execute one routine end to end and record the run. Shared by the cron
 *  tick and the Schedules view's "Run now" action. */
async function fireRoutine(routineId: string): Promise<void> {
  const r = useRoutines.getState().routines.find((x) => x.id === routineId);
  if (!r) return;
  const found = useGaps.getState().findAgent(r.agentId);
  if (!found) return;
  const { agent } = found;

  useRoutines.getState().update(r.id, { lastRunAt: Date.now(), nextRunAt: nextRun(r.cron, new Date()) });
  // A paired phone, if the agent has one: approvals go there and so does the result.
  const owner = ownerChannelRef(agent);
  try {
    const result = await recordRun(
      agent,
      "schedule",
      () => runAgentHeadless(agent, r.prompt || `Run routine: ${r.name}`, { channel: owner }),
      { summary: (res) => `⏰ ${r.name}: ${res.text.slice(0, 60)}` },
    );
    await deliverToDiscord(agent, `⏰ ${r.name}\n\n${result.text}`);
    if (owner) await sendText(owner, `⏰ ${r.name}\n\n${result.text || "Done."}`).catch(() => {});
  } catch {
    // recordRun already logged the failure; a routine must not take the
    // scheduler down with it.
  }
}

/** Trigger a routine immediately, regardless of its cron schedule. */
export async function runRoutineNow(routineId: string): Promise<void> {
  return fireRoutine(routineId);
}

/** How far back a late tick looks for minutes it missed. */
const CATCH_UP_MINUTES = 10;
let lastChecked = 0;

/**
 * Check every minute since the last tick, not just this one: a background
 * window's timers get throttled past a minute, and a routine due in the
 * skipped minute used to never run. Each routine fires at most once per tick,
 * and runs in parallel so one slow routine can't hold the others back.
 */
export function tick(now = new Date()): void {
  const minute = Math.floor(now.getTime() / 60000) * 60000;
  // The first tick after launch checks only now; catch-up covers gaps while open.
  const from = lastChecked ? Math.max(lastChecked + 60000, minute - (CATCH_UP_MINUTES - 1) * 60000) : minute;
  lastChecked = minute;

  for (const r of useRoutines.getState().routines) {
    if (!r.enabled) continue;
    for (let m = from; m <= minute; m += 60000) {
      // Already ran in or after this minute (Run now, or an earlier tick).
      if (r.lastRunAt && r.lastRunAt >= m) continue;
      if (!cronMatches(r.cron, new Date(m))) continue;
      // fireRoutine stamps lastRunAt before its first await, so a tick that
      // lands mid-run can't start the same routine twice.
      void fireRoutine(r.id);
      break;
    }
  }
}

/** Test hook: forget the last tick. */
export function resetScheduler(): void {
  lastChecked = 0;
}

/** Start the scheduler loop (idempotent). */
export function startScheduler(): () => void {
  if (timer) return () => {};
  // Align the first tick to reduce drift; then run every 30s.
  tick();
  timer = setInterval(() => tick(), 30_000);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
