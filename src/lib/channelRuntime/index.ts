/**
 * Live channel runtime (desktop): the phone side of Forge.
 *
 * The Rust side polls Telegram/Discord and emits `channel://message`; each
 * message flows through inbound.ts. Modules:
 *  - send.ts      — outbound text, shared helpers
 *  - approvals.ts — phone approvals and trust windows
 *  - pairing.ts   — pairing codes and owners
 *  - commands.ts  — /status, /stop, /new, …
 *  - runs.ts      — the per-chat task queue
 *  - inbound.ts   — authorise → route → run
 *  - this file    — starting, stopping and resuming bots
 */
import type { Agent, Channel } from "@/types/domain";
import { invoke, isDesktop } from "../platform";
import { setRemoteApprover, type ChannelRef } from "../approval";
import { errorMessage } from "../runError";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { channelKey } from "@/stores/channelRuntime";
import { remoteApprove, settleWhere } from "./approvals";
import { handleInbound } from "./inbound";
import { hostChannels, quiet, rt, type Host, type InboundMessage } from "./send";
import { logger } from "../log";

export { sendText, discordSend, isPack, hostChannels, type Host, type InboundMessage } from "./send";
export { remoteApprove, answerApproval, TRUST_MS, REMOTE_APPROVAL_TIMEOUT_MS } from "./approvals";
export { startPairing, cancelPairing, checkPairCode, removeOwner, PAIR_TTL_MS, MAX_PAIR_ATTEMPTS } from "./pairing";
export { handleInbound } from "./inbound";

const isBotKind = (kind: Channel["kind"]): kind is "telegram" | "discord" => kind === "telegram" || kind === "discord";

let listening = false;

/** Install the global inbound-message handler exactly once. */
export async function initChannelListener(): Promise<void> {
  if (listening || !isDesktop()) return;
  listening = true;
  setRemoteApprover(remoteApprove);
  useGaps.subscribe(stopOrphans);
  const { listen } = await import("@tauri-apps/api/event");
  await listen<InboundMessage>("channel://message", (e) => {
    // An inbound message must never take the listener down.
    handleInbound(e.payload).catch((error) => logger("channels").error("inbound message failed", { error }));
  });
}

/**
 * A bot whose agent or pack was deleted (or edited away) would keep polling
 * in Rust: messages to it went nowhere and it could hold the Mac awake. Stop
 * it, and drop anything it was waiting on.
 */
export function stopOrphans(): void {
  const running = Object.entries(rt().running).filter(([, on]) => on);
  if (running.length === 0) return;
  const known = new Set<string>();
  for (const g of useGaps.getState().gaps)
    for (const host of [g, ...g.agents] as Host[])
      for (const c of hostChannels(host)) known.add(channelKey(host.id, c.id));
  const orphans = running.map(([key]) => key).filter((key) => !known.has(key));
  for (const key of orphans) {
    quiet(invoke("channel_stop", { channelId: key }));
    settleWhere((ref) => ref.key === key, "no");
    rt().setRunning(key, false);
    rt().log(key, "system", "Stopped: its agent or pack was removed");
  }
  if (orphans.length) syncKeepAwake();
}

/** Keep the Mac awake while any remote-control bot is live (and the setting is on). */
export function syncKeepAwake(): void {
  if (!isDesktop()) return;
  const running = rt().running;
  const live = (h: Host) => hostChannels(h).some((c) => c.remoteControl && running[channelKey(h.id, c.id)]);
  const on = useSettings.getState().keepAwake && useGaps.getState().gaps.some((g) => live(g) || g.agents.some(live));
  quiet(invoke("keep_awake", { on }));
}

/** Start a channel's bot poller. `host` is the agent or pack it fronts. */
export async function startChannel(host: Host, channel: Channel): Promise<void> {
  const key = channelKey(host.id, channel.id);
  try {
    await initChannelListener();
    const bot =
      channel.kind === "discord"
        ? await invoke<{ username: string }>("discord_start", {
            channelId: key,
            token: channel.token ?? "",
            discordChannelId: channel.config?.channelId ?? "",
            trigger: channel.config?.trigger ?? "all",
          })
        : await invoke<{ username: string }>("telegram_start", { channelId: key, token: channel.token ?? "" });
    rt().setRunning(key, true);
    rt().setError(key, "");
    rt().setBotName(key, bot.username);
    rt().log(key, "system", `${host.name} is live on ${channel.kind}${bot.username ? ` as @${bot.username}` : ""}`);
    useGaps.getState().upsertChannel(host.id, { ...channel, status: "active" });
  } catch (e) {
    logger("channels").warn("bot failed to start", { key, kind: channel.kind, error: e });
    rt().setError(key, errorMessage(e));
    rt().setRunning(key, false);
  }
  syncKeepAwake();
}

export async function stopChannel(host: Host, channel: Channel): Promise<void> {
  const key = channelKey(host.id, channel.id);
  quiet(invoke("channel_stop", { channelId: key }));
  settleWhere((ref) => ref.key === key, "no");
  rt().setRunning(key, false);
  rt().log(key, "system", `${host.name} stopped on ${channel.kind}`);
  useGaps.getState().upsertChannel(host.id, { ...channel, status: "inactive" });
  syncKeepAwake();
}

/**
 * Bring back every bot that was live when Forge last quit. "active" is a
 * persisted intent; without this it went stale on restart — the badge said
 * live while nothing was listening.
 */
export async function resumeChannels(): Promise<void> {
  if (!isDesktop()) return;
  for (const gap of useGaps.getState().gaps)
    for (const host of [gap, ...gap.agents] as Host[])
      for (const channel of hostChannels(host))
        if (channel.status === "active" && channel.token && isBotKind(channel.kind)) {
          await startChannel(host, channel);
        }
}

/**
 * Where an agent's unattended work reports: the first paired owner on a live
 * remote-control channel — the agent's own, else its pack's. Schedules
 * deliver results there and route their approvals there, so a routine that
 * needs a yes can get one from the phone.
 */
export function ownerChannelRef(agent: Agent): ChannelRef | undefined {
  const running = rt().running;
  const pack = useGaps.getState().findGap(agent.gapId);
  for (const host of (pack ? [agent, pack] : [agent]) as Host[])
    for (const c of hostChannels(host)) {
      const key = channelKey(host.id, c.id);
      const owner = c.owners?.[0];
      if (c.remoteControl && owner && c.token && running[key] && isBotKind(c.kind)) {
        return { kind: c.kind, token: c.token, chatId: owner.chatId, key, remote: true };
      }
    }
  return undefined;
}
