/**
 * Live channel runtime (desktop). Bridges the native bot pollers to the agent
 * engine: the Rust side polls Telegram/Discord and emits `channel://message`;
 * here we route each inbound message to the owning agent, generate a reply,
 * and send it back through the same provider. Both channels are bidirectional;
 * Discord additionally supports plain outbound webhooks.
 */

import type { Agent, Channel } from "@/types/domain";
import { invoke, isDesktop } from "./platform";
import { runAgentHeadless } from "./agentRun";
import { recordRun } from "./runner";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";

interface InboundMessage {
  channel_id: string;
  chat_id: string;
  text: string;
  from: string;
}

let listening = false;

/** Install the global inbound-message handler exactly once. */
export async function initChannelListener(): Promise<void> {
  if (listening || !isDesktop()) return;
  listening = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<InboundMessage>("channel://message", async (e) => {
    const { channel_id, chat_id, text } = e.payload;
    const agentId = channel_id.split("__")[0];
    const found = useGaps.getState().findAgent(agentId);
    if (!found) return;
    const { agent } = found;
    const channel = agent.channels.find((c) => channelKey(agent.id, c.id) === channel_id);
    if (!channel?.token) return;

    try {
      const result = await recordRun(agent, "channel", () => runAgentHeadless(agent, text), {
        summary: () => `${channel.kind}: ${text.slice(0, 50)}`,
      });
      // Reply through whichever provider the message arrived on.
      if (channel.kind === "discord") {
        await invoke("discord_send_bot", { token: channel.token, channelId: chat_id, text: result.text || "…" });
      } else {
        await invoke("telegram_send", { token: channel.token, chatId: chat_id, text: result.text || "…" });
      }
    } catch {
      // recordRun logged it; an inbound message must not kill the listener.
    }
  });
}

export async function startTelegram(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
  const rt = useChannelRuntime.getState();
  try {
    await initChannelListener();
    await invoke("telegram_start", { channelId: key, token: channel.token ?? "" });
    rt.setRunning(key, true);
    rt.setError(key, "");
    useGaps.getState().upsertChannel(agent.id, { ...channel, status: "active" });
  } catch (e: any) {
    rt.setError(key, String(e?.message ?? e));
    rt.setRunning(key, false);
  }
}

export async function stopChannel(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
  try {
    await invoke("channel_stop", { channelId: key });
  } catch {
    /* ignore */
  }
  useChannelRuntime.getState().setRunning(key, false);
  useGaps.getState().upsertChannel(agent.id, { ...channel, status: "inactive" });
}

/** Start the two-way Discord bot poller for an agent's channel. */
export async function startDiscord(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
  const rt = useChannelRuntime.getState();
  try {
    await initChannelListener();
    await invoke("discord_start", {
      channelId: key,
      token: channel.token ?? "",
      discordChannelId: channel.config?.channelId ?? "",
      trigger: channel.config?.trigger ?? "all",
    });
    rt.setRunning(key, true);
    rt.setError(key, "");
    useGaps.getState().upsertChannel(agent.id, { ...channel, status: "active" });
  } catch (e: any) {
    rt.setError(key, String(e?.message ?? e));
    rt.setRunning(key, false);
  }
}

/** Send a one-off message to a Discord channel via an incoming webhook. */
export async function discordSend(webhook: string, text: string): Promise<void> {
  await invoke("discord_send", { webhook, text });
}
