/** Outbound messages and the shared bits every channel module reads. */
import type { ChannelRef } from "../approval";
import { invoke } from "../platform";
import { useChannelRuntime } from "@/stores/channelRuntime";

export interface InboundMessage {
  channel_id: string;
  chat_id: string;
  sender_id: string;
  from: string;
  text: string;
  kind: "message" | "callback";
  files: { file_ref: string; name: string }[];
}

export const rt = () => useChannelRuntime.getState();
export const chatKeyOf = (ref: Pick<ChannelRef, "key" | "chatId">) => `${ref.key}:${ref.chatId}`;

/** Fire and forget: a failed notification must never break the flow that sent it. */
export const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** Send text (chunked natively); Telegram buttons ride on the last chunk. */
export async function sendText(ref: ChannelRef, text: string, buttons?: [string, string][]): Promise<string> {
  if (ref.kind === "discord") {
    return invoke<string>("discord_send_bot", { token: ref.token, channelId: ref.chatId, text });
  }
  const id = await invoke<number>("telegram_send", {
    token: ref.token,
    chatId: ref.chatId,
    text,
    buttons: buttons ?? null,
  });
  return String(id);
}

/** Replace a prompt's text (Telegram); Discord can't edit, so it posts anew. */
export async function updateText(ref: ChannelRef, messageId: string, text: string): Promise<void> {
  if (ref.kind === "telegram" && messageId && messageId !== "0") {
    await invoke("telegram_edit", { token: ref.token, chatId: ref.chatId, messageId: Number(messageId), text });
  } else {
    await sendText(ref, text);
  }
}

/** Send a one-off message to a Discord channel via an incoming webhook. */
export async function discordSend(webhook: string, text: string): Promise<void> {
  await invoke("discord_send", { webhook, text });
}
