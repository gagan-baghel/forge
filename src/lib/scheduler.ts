/**
 * Routine scheduler. Ticks once a minute while the app is open, fires any due
 * routines through the agent engine, and records each as a run. Local-first:
 * routines run when Forge is running (no cloud cron).
 */

import { cronMatches, nextRun } from "./cron";
import { runAgentHeadless } from "./agentRun";
import { recordRun } from "./runner";
import { discordSend } from "./channelRuntime";
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
  try {
    const result = await recordRun(
      agent,
      "schedule",
      () => runAgentHeadless(agent, r.prompt || `Run routine: ${r.name}`),
      { summary: (res) => `⏰ ${r.name}: ${res.text.slice(0, 60)}` },
    );
    // If the agent has a Discord webhook, deliver the result there.
    await deliverToDiscord(agent, `⏰ ${r.name}\n\n${result.text}`);
  } catch {
    // recordRun already logged the failure; a routine must not take the
    // scheduler down with it.
  }
}

/** Trigger a routine immediately, regardless of its cron schedule. */
export async function runRoutineNow(routineId: string): Promise<void> {
  return fireRoutine(routineId);
}

async function tick() {
  const now = new Date();
  const minuteStamp = Math.floor(now.getTime() / 60000) * 60000;
  const routines = useRoutines.getState().routines;

  for (const r of routines) {
    if (!r.enabled) continue;
    // Skip if we already fired this minute.
    if (r.lastRunAt && Math.floor(r.lastRunAt / 60000) * 60000 === minuteStamp) continue;
    if (!cronMatches(r.cron, now)) continue;
    await fireRoutine(r.id);
  }
}

/** Start the scheduler loop (idempotent). */
export function startScheduler(): () => void {
  if (timer) return () => {};
  // Align the first tick to reduce drift; then run every 30s.
  void tick();
  timer = setInterval(tick, 30_000);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
