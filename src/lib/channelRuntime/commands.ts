/**
 * Owner slash-commands. Each command is one entry in COMMANDS; adding or
 * removing a command touches nothing else (update HELP to match).
 */
import type { Agent, Channel } from "@/types/domain";
import type { ChannelRef } from "../approval";
import { invoke } from "../platform";
import { errorMessage } from "../runError";
import { sendImageToChannel } from "../tools";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { settleWhere } from "./approvals";
import { removeOwner } from "./pairing";
import { abortChat } from "./runs";
import { chatKeyOf, quiet, rt, sendText, type InboundMessage } from "./send";

export const HELP = [
  "Just message me what you need — I'll do it and report back.",
  "",
  "/status — what I'm doing, and whether remote control is on",
  "/stop — stop the current task",
  "/new — start a fresh conversation",
  "/screenshot — see your screen right now",
  '/lock — end an "Allow 15 min" window',
  "/unpair — disconnect this chat",
].join("\n");

export interface CommandContext {
  agent: Agent;
  channel: Channel;
  ref: ChannelRef;
  msg: InboundMessage;
  chatKey: string;
}

type Command = (c: CommandContext) => void | Promise<void>;

function remoteState({ agent, channel, chatKey }: CommandContext): string {
  const settings = useSettings.getState();
  const until = rt().trustUntil[chatKey] ?? 0;
  const busy = !!rt().busy[chatKey];
  const runtime = (agent.runtime ?? settings.runtime) === "claude-code" ? "Claude Code" : "Claude API";
  return [
    `${agent.name} · ${runtime} · ${agent.model}`,
    busy ? "Working on a task (/stop to cancel)" : "Idle",
    channel.remoteControl ? "Remote control: on — machine actions ask you first" : "Remote control: off — chat only",
    until > Date.now() ? `Trust window: until ${new Date(until).toLocaleTimeString()}` : "Trust window: off",
    `Keep Mac awake: ${settings.keepAwake ? "on" : "off"}`,
  ].join("\n");
}

const help: Command = ({ agent, ref }) => quiet(sendText(ref, `${agent.name} — ${agent.role}\n\n${HELP}`));

const COMMANDS: Record<string, Command> = {
  start: help,
  help,
  status: (c) => quiet(sendText(c.ref, remoteState(c))),
  stop: ({ ref, chatKey }) => {
    settleWhere((r) => chatKeyOf(r) === chatKey, "no");
    if (!abortChat(chatKey)) quiet(sendText(ref, "Nothing is running."));
  },
  new: ({ agent, ref, msg, chatKey }) => {
    useConversations.getState().newConversation(agent.id, { kind: ref.kind, key: chatKey, from: msg.from });
    quiet(sendText(ref, "Started a fresh conversation."));
  },
  lock: ({ ref, chatKey }) => {
    rt().setTrust(chatKey, null);
    quiet(sendText(ref, "🔒 Locked — every action asks you first again."));
  },
  unpair: ({ agent, channel, ref, msg }) => {
    removeOwner(agent.id, channel, msg.sender_id);
    rt().log(ref.key, "security", `${msg.from} unpaired`);
    quiet(sendText(ref, "Disconnected. Pair again from Forge any time."));
  },
  screenshot: async ({ channel, ref }) => {
    if (!channel.remoteControl) {
      quiet(sendText(ref, "Remote control is off for this agent — turn it on in Forge → Remote."));
      return;
    }
    // An owner asking for it directly is the approval.
    try {
      const shot = await invoke<{ path: string }>("screen_capture");
      await sendImageToChannel(ref, shot.path, "Your screen");
    } catch (e) {
      quiet(sendText(ref, `⚠️ ${errorMessage(e)}`));
    }
  },
};

/** The command a message invokes, if any (`/stop`, `/stop@bot`). */
export function commandFor(text: string): Command | undefined {
  const name = /^\/(\w+)(?:@\w+)?\b/.exec(text)?.[1]?.toLowerCase();
  return name ? COMMANDS[name] : undefined;
}
