export type ChannelKind = "telegram" | "discord";

export const PROVIDER: Record<ChannelKind, { name: string; icon: string }> = {
  telegram: { name: "Telegram", icon: "send" },
  discord: { name: "Discord", icon: "message" },
};
