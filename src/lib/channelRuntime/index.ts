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
import { quiet, rt, type InboundMessage } from "./send";
import { logger } from "../log";

export { sendText, discordSend, type InboundMessage } from "./send";
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
  const { listen } = await import("@tauri-apps/api/event");
  await listen<InboundMessage>("channel://message", (e) => {
    // An inbound message must never take the listener down.
    handleInbound(e.payload).catch((error) => logger("channels").error("inbound message failed", { error }));
  });
}

/** Keep the Mac awake while any remote-control bot is live (and the setting is on). */
export function syncKeepAwake(): void {
  if (!isDesktop()) return;
  const running = rt().running;
  const on =
    useSettings.getState().keepAwake &&
    useGaps
      .getState()
      .gaps.some((g) =>
        g.agents.some((a) => a.channels.some((c) => c.remoteControl && running[channelKey(a.id, c.id)])),
      );
  quiet(invoke("keep_awake", { on }));
}

/** Start a channel's bot poller. */
export async function startChannel(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
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
    rt().log(key, "system", `${agent.name} is live on ${channel.kind}${bot.username ? ` as @${bot.username}` : ""}`);
    useGaps.getState().upsertChannel(agent.id, { ...channel, status: "active" });
  } catch (e) {
    logger("channels").warn("bot failed to start", { key, kind: channel.kind, error: e });
    rt().setError(key, errorMessage(e));
    rt().setRunning(key, false);
  }
  syncKeepAwake();
}

export async function stopChannel(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
  quiet(invoke("channel_stop", { channelId: key }));
  settleWhere((ref) => ref.key === key, "no");
  rt().setRunning(key, false);
  rt().log(key, "system", `${agent.name} stopped on ${channel.kind}`);
  useGaps.getState().upsertChannel(agent.id, { ...channel, status: "inactive" });
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
    for (const agent of gap.agents)
      for (const channel of agent.channels)
        if (channel.status === "active" && channel.token && isBotKind(channel.kind)) {
          await startChannel(agent, channel);
        }
}

/**
 * Where an agent's unattended work reports: the first paired owner on a live
 * remote-control channel. Schedules deliver results there and route their
 * approvals there, so a routine that needs a yes can get one from the phone.
 */
export function ownerChannelRef(agent: Agent): ChannelRef | undefined {
  const running = rt().running;
  for (const c of agent.channels) {
    const key = channelKey(agent.id, c.id);
    const owner = c.owners?.[0];
    if (c.remoteControl && owner && c.token && running[key] && isBotKind(c.kind)) {
      return { kind: c.kind, token: c.token, chatId: owner.chatId, key, remote: true };
    }
  }
  return undefined;
}
