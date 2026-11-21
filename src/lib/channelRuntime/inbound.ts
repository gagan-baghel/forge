/**
 * Every inbound message is:
 *  1. authorised — only paired owners reach the agent. Anyone else can do one
 *     thing: `/pair <code>` with the short-lived code Forge shows on screen;
 *  2. routed — owner commands (/stop, /new, /status, …) are handled directly;
 *     approval answers resolve the prompt they belong to;
 *  3. run — everything else becomes a turn in that chat's conversation.
 */
import type { Channel, ChannelOwner } from "@/types/domain";
import type { ChannelRef } from "../approval";
import { useGaps } from "@/stores/gaps";
import { channelKey } from "@/stores/channelRuntime";
import { settleFromChat, typedAnswer, type Decision } from "./approvals";
import { HELP, commandFor } from "./commands";
import { checkPairCode } from "./pairing";
import { enqueue } from "./runs";
import { chatKeyOf, hostChannels, quiet, rt, sendText, type Host, type InboundMessage } from "./send";

const LOG_PREVIEW_CHARS = 140;

function resolveChannel(channelId: string): { host: Host; channel: Channel } | undefined {
  // Match the whole key: nanoid ids can contain "_", so splitting on "__"
  // would misroute a host whose id ends in "_" or contains "__".
  for (const g of useGaps.getState().gaps)
    for (const host of [g, ...g.agents] as Host[]) {
      const channel = hostChannels(host).find((c) => channelKey(host.id, c.id) === channelId);
      if (channel) return { host, channel };
    }
  return undefined;
}

/** Strangers: pairing is the only thing they can do. */
function handleStranger(host: Host, channel: Channel, ref: ChannelRef, msg: InboundMessage, text: string) {
  if (msg.kind === "callback") return;
  const who = `${msg.from} (id ${msg.sender_id})`;
  const pair = /^\/pair(?:@\w+)?\s+(\d{6})$/i.exec(text);
  if (!pair) {
    rt().log(ref.key, "security", `Blocked a message from ${who}`);
    quiet(
      sendText(
        ref,
        "🔒 This is a private Forge agent.\n\nTo connect, open Forge on your computer → Remote → Pair a phone, then send /pair followed by the code shown.",
      ),
    );
    return;
  }
  const verdict = checkPairCode(ref.key, pair[1]);
  if (verdict !== "ok") {
    rt().log(ref.key, "security", `Rejected a pairing attempt from ${who}`);
    quiet(
      sendText(
        ref,
        verdict === "none"
          ? "No pairing is open. Start one in Forge → Remote → Pair a phone."
          : "That code isn't right.",
      ),
    );
    return;
  }
  const owner: ChannelOwner = { id: msg.sender_id, name: msg.from, chatId: msg.chat_id, pairedAt: Date.now() };
  useGaps.getState().upsertChannel(host.id, { ...channel, owners: [...(channel.owners ?? []), owner] });
  rt().log(ref.key, "security", `Paired ${who}`);
  quiet(sendText(ref, `✅ Paired with ${host.name}.\n\n${HELP}`));
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const found = resolveChannel(msg.channel_id);
  const token = found?.channel.token;
  if (!found || !token) return;
  const { host, channel } = found;
  const ref: ChannelRef = {
    kind: channel.kind === "discord" ? "discord" : "telegram",
    token,
    chatId: msg.chat_id,
    key: msg.channel_id,
    remote: !!channel.remoteControl,
  };
  const text = msg.text.trim();

  if (!(channel.owners ?? []).some((o) => o.id === msg.sender_id)) {
    handleStranger(host, channel, ref, msg, text);
    return;
  }

  if (msg.kind === "callback") {
    const m = /^fa:(ok|trust|no):([\w-]+)$/.exec(text);
    if (m) settleFromChat(ref, m[2], m[1] as Decision);
    return;
  }

  if (typedAnswer(ref, text)) return;

  rt().log(ref.key, "in", `${msg.from}: ${text.slice(0, LOG_PREVIEW_CHARS) || `${msg.files.length} file(s)`}`);
  const command = commandFor(text);
  if (command) {
    await command({ host, channel, ref, msg, chatKey: chatKeyOf(ref) });
    return;
  }
  enqueue(host, ref, msg);
}
