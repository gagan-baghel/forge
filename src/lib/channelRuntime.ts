/**
 * Live channel runtime (desktop): the phone side of Forge.
 *
 * The Rust side polls Telegram/Discord and emits `channel://message`. Here
 * each inbound message is:
 *
 *  1. authorised — only paired owners reach the agent. Anyone else can do one
 *     thing: `/pair <code>` with the short-lived code Forge shows on screen;
 *  2. routed — owner commands (/stop, /new, /status, …) are handled directly;
 *     approval answers resolve the prompt they belong to;
 *  3. run — everything else becomes a turn in that chat's conversation (the
 *     same conversation the desktop chat shows), with the reply sent back.
 *
 * For a channel with remote control on, the agent's machine actions are
 * approved from the phone: each prompt arrives with Approve / Allow 15 min /
 * Deny. "Allow 15 min" opens a trust window for that chat — actions then run
 * without asking but are still announced, and anything proposed after the
 * turn read outside content asks again regardless.
 */

import { nanoid } from "nanoid";
import type { Agent, Channel, ChannelOwner } from "@/types/domain";
import { invoke, isDesktop } from "./platform";
import { setRemoteApprover, UNTRUSTED_WARNING, type ApprovalRequest, type ApprovalResult, type ChannelRef } from "./approval";
import { runConversationTurn } from "./conversationTurn";
import { sendImageToChannel } from "./tools";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";

export interface InboundMessage {
  channel_id: string;
  chat_id: string;
  sender_id: string;
  from: string;
  text: string;
  kind: "message" | "callback";
  files: { file_ref: string; name: string }[];
}

export const PAIR_TTL_MS = 10 * 60_000;
export const MAX_PAIR_ATTEMPTS = 5;
export const TRUST_MS = 15 * 60_000;
/** A phone approval waits longer than a desktop one: the owner may be busy. */
export const REMOTE_APPROVAL_TIMEOUT_MS = 10 * 60_000;

const rt = () => useChannelRuntime.getState();
const chatKeyOf = (ref: Pick<ChannelRef, "key" | "chatId">) => `${ref.key}:${ref.chatId}`;

/* -------------------------------- Sending -------------------------------- */

/** Send text (chunked natively); Telegram buttons ride on the last chunk. */
export async function sendText(ref: ChannelRef, text: string, buttons?: [string, string][]): Promise<string> {
  if (ref.kind === "discord") {
    return invoke<string>("discord_send_bot", { token: ref.token, channelId: ref.chatId, text });
  }
  const id = await invoke<number>("telegram_send", { token: ref.token, chatId: ref.chatId, text, buttons: buttons ?? null });
  return String(id);
}

/** Replace a prompt's text (Telegram); Discord can't edit, so it posts anew. */
async function updateText(ref: ChannelRef, messageId: string, text: string): Promise<void> {
  if (ref.kind === "telegram" && messageId && messageId !== "0") {
    await invoke("telegram_edit", { token: ref.token, chatId: ref.chatId, messageId: Number(messageId), text });
  } else {
    await sendText(ref, text);
  }
}

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/* ------------------------------- Approvals ------------------------------- */

interface PendingApproval {
  ref: ChannelRef;
  title: string;
  messageId: string;
  resolve: (r: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingApproval>();

type Decision = "ok" | "trust" | "no" | "timeout";

function settle(id: string, decision: Decision): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  rt().removeApproval(id);
  const chatKey = chatKeyOf(p.ref);
  if (decision === "trust") rt().setTrust(chatKey, Date.now() + TRUST_MS);
  const label = {
    ok: "✅ Approved",
    trust: "⏱ Approved — actions run without asking for 15 min (/lock to end)",
    no: "✖ Denied",
    timeout: "⌛ Timed out — not done",
  }[decision];
  quiet(updateText(p.ref, p.messageId, `${label}: ${p.title}`));
  rt().log(p.ref.key, "approval", `${label}: ${p.title}`);
  p.resolve(decision === "ok" || decision === "trust" ? "ok" : decision === "no" ? "denied" : "timeout");
  return true;
}

/** Ask the owner's phone. Registered as the remote approver on init. */
export async function remoteApprove(req: ApprovalRequest & { channel: ChannelRef }): Promise<ApprovalResult> {
  const ref = req.channel;
  const until = rt().trustUntil[chatKeyOf(ref)] ?? 0;

  // Inside a trust window: run, but say what ran. Outside content in this
  // turn voids the window — that is exactly when an injected instruction
  // would try to ride it.
  if (until > Date.now() && !req.turn?.untrusted) {
    const note = `▶ ${req.title.replace(/\?$/, "")}\n${req.body.slice(0, 600)}`;
    quiet(sendText(ref, note));
    rt().log(ref.key, "approval", `Auto-approved (trust window): ${req.title}`);
    return "ok";
  }

  const id = nanoid(8);
  const warning = req.turn?.untrusted ? `\n\n${UNTRUSTED_WARNING}` : "";
  const howTo = ref.kind === "discord" ? "\n\nReply yes, trust (15 min), or no." : "";
  const text = `🔐 ${req.title}\n\n${req.body}${warning}${howTo}`;
  const buttons: [string, string][] = [
    ["Approve", `fa:ok:${id}`],
    ["Allow 15 min", `fa:trust:${id}`],
    ["Deny", `fa:no:${id}`],
  ];

  let messageId = "";
  try {
    messageId = await sendText(ref, text, buttons);
  } catch (e: any) {
    rt().log(ref.key, "system", `Couldn't deliver an approval prompt: ${e?.message ?? e}`);
    return "denied";
  }

  rt().addApproval({ id, key: ref.key, chatId: ref.chatId, title: req.title, body: req.body, createdAt: Date.now() });
  rt().log(ref.key, "approval", `Asked: ${req.title}`);
  return new Promise<ApprovalResult>((resolve) => {
    const timer = setTimeout(() => settle(id, "timeout"), REMOTE_APPROVAL_TIMEOUT_MS);
    pending.set(id, { ref, title: req.title, messageId, resolve, timer });
  });
}

/** Answer a pending approval from the desktop (the Remote view). */
export function answerApproval(id: string, decision: "ok" | "trust" | "no"): boolean {
  return settle(id, decision);
}

const YES = /^(y|yes|ok|okay|approve|approved|go|run it)$/i;
const TRUST = /^(trust|allow|allow 15( min)?|always)$/i;
const NO = /^(n|no|deny|denied|cancel|nope)$/i;

/** A typed answer ("yes"/"trust"/"no") to this chat's newest open prompt. */
function typedAnswer(ref: ChannelRef, text: string): boolean {
  const decision: Decision | null = YES.test(text) ? "ok" : TRUST.test(text) ? "trust" : NO.test(text) ? "no" : null;
  if (!decision) return false;
  const mine = [...pending.entries()].filter(([, p]) => chatKeyOf(p.ref) === chatKeyOf(ref));
  const newest = mine[mine.length - 1];
  return newest ? settle(newest[0], decision) : false;
}

/* -------------------------------- Pairing -------------------------------- */

/** Issue a fresh 6-digit pairing code for a channel. */
export function startPairing(agent: Agent, channel: Channel): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  rt().setPairing(channelKey(agent.id, channel.id), { code, expiresAt: Date.now() + PAIR_TTL_MS, attempts: 0 });
  return code;
}

export function cancelPairing(agent: Agent, channel: Channel): void {
  rt().setPairing(channelKey(agent.id, channel.id), null);
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

export function removeOwner(agentId: string, channel: Channel, ownerId: string): void {
  useGaps.getState().upsertChannel(agentId, {
    ...channel,
    owners: (channel.owners ?? []).filter((o) => o.id !== ownerId),
  });
}

/* -------------------------------- Commands ------------------------------- */

const HELP = [
  "Just message me what you need — I'll do it and report back.",
  "",
  "/status — what I'm doing, and whether remote control is on",
  "/stop — stop the current task",
  "/new — start a fresh conversation",
  "/screenshot — see your screen right now",
  "/lock — end an \"Allow 15 min\" window",
  "/unpair — disconnect this chat",
].join("\n");

function remoteState(agent: Agent, channel: Channel, ref: ChannelRef): string {
  const settings = useSettings.getState();
  const until = rt().trustUntil[chatKeyOf(ref)] ?? 0;
  const busy = !!rt().busy[chatKeyOf(ref)];
  const runtime = (agent.runtime ?? settings.runtime) === "claude-code" ? "Claude Code" : "Claude API";
  return [
    `${agent.name} · ${runtime} · ${agent.model}`,
    busy ? "Working on a task (/stop to cancel)" : "Idle",
    channel.remoteControl ? "Remote control: on — machine actions ask you first" : "Remote control: off — chat only",
    until > Date.now() ? `Trust window: until ${new Date(until).toLocaleTimeString()}` : "Trust window: off",
    `Keep Mac awake: ${settings.keepAwake ? "on" : "off"}`,
  ].join("\n");
}

/* --------------------------------- Runs ---------------------------------- */

const controllers = new Map<string, AbortController>();
const queues = new Map<string, Promise<void>>();

/** Fetch an owner's attachments into ~/Downloads/Forge; returns local paths. */
async function fetchFiles(ref: ChannelRef, files: InboundMessage["files"]): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files) {
    try {
      paths.push(await invoke<string>("channel_fetch_file", { kind: ref.kind, token: ref.token, fileRef: f.file_ref, name: f.name }));
    } catch (e: any) {
      rt().log(ref.key, "system", `Couldn't download ${f.name}: ${e?.message ?? e}`);
    }
  }
  return paths;
}

async function runForChat(agent: Agent, ref: ChannelRef, msg: InboundMessage): Promise<void> {
  const chatKey = chatKeyOf(ref);
  const controller = new AbortController();
  controllers.set(chatKey, controller);
  rt().setBusy(chatKey, true);

  // "typing…" expires after ~5s on both providers; keep it alive.
  const typing = () => quiet(invoke("channel_typing", { kind: ref.kind, token: ref.token, chatId: ref.chatId }));
  typing();
  const typingTimer = setInterval(typing, 4500);

  try {
    const paths = await fetchFiles(ref, msg.files);
    const prompt =
      (msg.text || "(no text — see the attached files)") +
      (paths.length ? `\n\n[The user sent ${paths.length} file(s), saved on this computer at:\n${paths.map((p) => `- ${p}`).join("\n")}]` : "");
    const convId = useConversations
      .getState()
      .conversationFor(agent.id, { kind: ref.kind, key: chatKey, from: msg.from });

    const result = await runConversationTurn(agent, convId, prompt, {
      trigger: "channel",
      signal: controller.signal,
      channel: ref,
      headless: true,
      summary: () => `${ref.kind}: ${msg.text.slice(0, 50)}`,
    });
    await sendText(ref, result.text || "Done.");
    rt().log(ref.key, "out", (result.text || "Done.").slice(0, 140));
  } catch (err: any) {
    const text = err?.name === "AbortError" ? "Stopped." : `⚠️ ${err?.message ?? err}`;
    quiet(sendText(ref, text));
    rt().log(ref.key, "system", text.slice(0, 140));
  } finally {
    clearInterval(typingTimer);
    controllers.delete(chatKey);
    rt().setBusy(chatKey, false);
  }
}

/** One task at a time per chat; later messages wait their turn. */
function enqueue(agent: Agent, ref: ChannelRef, msg: InboundMessage): void {
  const chatKey = chatKeyOf(ref);
  if (rt().busy[chatKey]) {
    const waiting = [...pending.values()].some((p) => chatKeyOf(p.ref) === chatKey);
    quiet(
      sendText(
        ref,
        waiting
          ? "An approval is waiting above — answer it first. Your new message is queued (/stop cancels the current task)."
          : "Queued — I'll start on this when the current task finishes. /stop cancels it.",
      ),
    );
  }
  const prev = queues.get(chatKey) ?? Promise.resolve();
  const next = prev.then(() => runForChat(agent, ref, msg));
  queues.set(chatKey, next);
  void next.finally(() => {
    if (queues.get(chatKey) === next) queues.delete(chatKey);
  });
}

/* -------------------------------- Inbound -------------------------------- */

function resolveChannel(channelId: string): { agent: Agent; channel: Channel } | undefined {
  // Match the whole key: nanoid ids can contain "_", so splitting on "__"
  // would misroute an agent whose id ends in "_" or contains "__".
  for (const g of useGaps.getState().gaps)
    for (const agent of g.agents) {
      const channel = agent.channels.find((c) => channelKey(agent.id, c.id) === channelId);
      if (channel) return { agent, channel };
    }
  return undefined;
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const found = resolveChannel(msg.channel_id);
  if (!found?.channel.token) return;
  const { agent, channel } = found;
  const kind = channel.kind === "discord" ? "discord" : "telegram";
  const ref: ChannelRef = {
    kind,
    token: channel.token!,
    chatId: msg.chat_id,
    key: msg.channel_id,
    remote: !!channel.remoteControl,
  };
  const text = msg.text.trim();
  const owners = channel.owners ?? [];
  const isOwner = owners.some((o) => o.id === msg.sender_id);

  /* Strangers: pairing is the only thing they can do. */
  if (!isOwner) {
    if (msg.kind === "callback") return;
    const pair = /^\/pair(?:@\w+)?\s+(\d{6})$/i.exec(text);
    if (!pair) {
      rt().log(ref.key, "security", `Blocked a message from ${msg.from} (id ${msg.sender_id})`);
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
      rt().log(ref.key, "security", `Rejected a pairing attempt from ${msg.from} (id ${msg.sender_id})`);
      quiet(sendText(ref, verdict === "none" ? "No pairing is open. Start one in Forge → Remote → Pair a phone." : "That code isn't right."));
      return;
    }
    const owner: ChannelOwner = { id: msg.sender_id, name: msg.from, chatId: msg.chat_id, pairedAt: Date.now() };
    useGaps.getState().upsertChannel(agent.id, { ...channel, owners: [...owners, owner] });
    rt().log(ref.key, "security", `Paired ${msg.from} (id ${msg.sender_id})`);
    quiet(sendText(ref, `✅ Paired with ${agent.name}.\n\n${HELP}`));
    return;
  }

  /* Owners. */
  if (msg.kind === "callback") {
    const m = /^fa:(ok|trust|no):([\w-]+)$/.exec(text);
    const p = m && pending.get(m[2]);
    // The button must belong to a prompt sent to this very chat.
    if (m && p && chatKeyOf(p.ref) === chatKeyOf(ref)) settle(m[2], m[1] as Decision);
    return;
  }

  if (typedAnswer(ref, text)) return;

  rt().log(ref.key, "in", `${msg.from}: ${text.slice(0, 140) || `${msg.files.length} file(s)`}`);
  const command = /^\/(\w+)(?:@\w+)?\b/.exec(text)?.[1]?.toLowerCase();
  const chatKey = chatKeyOf(ref);
  switch (command) {
    case "start":
    case "help":
      quiet(sendText(ref, `${agent.name} — ${agent.role}\n\n${HELP}`));
      return;
    case "status":
      quiet(sendText(ref, remoteState(agent, channel, ref)));
      return;
    case "stop": {
      const running = controllers.get(chatKey);
      for (const [id, p] of pending) if (chatKeyOf(p.ref) === chatKey) settle(id, "no");
      running?.abort();
      if (!running) quiet(sendText(ref, "Nothing is running."));
      return;
    }
    case "new":
      useConversations.getState().newConversation(agent.id, { kind, key: chatKey, from: msg.from });
      quiet(sendText(ref, "Started a fresh conversation."));
      return;
    case "lock":
      rt().setTrust(chatKey, null);
      quiet(sendText(ref, "🔒 Locked — every action asks you first again."));
      return;
    case "unpair":
      removeOwner(agent.id, channel, msg.sender_id);
      rt().log(ref.key, "security", `${msg.from} unpaired`);
      quiet(sendText(ref, "Disconnected. Pair again from Forge any time."));
      return;
    case "screenshot":
      if (!channel.remoteControl) {
        quiet(sendText(ref, "Remote control is off for this agent — turn it on in Forge → Remote."));
        return;
      }
      // An owner asking for it directly is the approval.
      try {
        const shot = await invoke<{ path: string }>("screen_capture");
        await sendImageToChannel(ref, shot.path, "Your screen");
      } catch (e: any) {
        quiet(sendText(ref, `⚠️ ${e?.message ?? e}`));
      }
      return;
  }

  enqueue(agent, ref, msg);
}

/* ------------------------------- Lifecycle ------------------------------- */

let listening = false;

/** Install the global inbound-message handler exactly once. */
export async function initChannelListener(): Promise<void> {
  if (listening || !isDesktop()) return;
  listening = true;
  setRemoteApprover(remoteApprove);
  const { listen } = await import("@tauri-apps/api/event");
  await listen<InboundMessage>("channel://message", (e) => {
    // An inbound message must never take the listener down.
    handleInbound(e.payload).catch(() => {});
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
      .gaps.some((g) => g.agents.some((a) => a.channels.some((c) => c.remoteControl && running[channelKey(a.id, c.id)])));
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
  } catch (e: any) {
    rt().setError(key, String(e?.message ?? e));
    rt().setRunning(key, false);
  }
  syncKeepAwake();
}

export async function stopChannel(agent: Agent, channel: Channel): Promise<void> {
  const key = channelKey(agent.id, channel.id);
  quiet(invoke("channel_stop", { channelId: key }));
  for (const [id, p] of pending) if (p.ref.key === key) settle(id, "no");
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
  for (const gap of useGaps.getState().gaps) {
    for (const agent of gap.agents) {
      for (const channel of agent.channels) {
        if (channel.status === "active" && channel.token && (channel.kind === "telegram" || channel.kind === "discord")) {
          await startChannel(agent, channel);
        }
      }
    }
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
    if (c.remoteControl && owner && c.token && running[key] && (c.kind === "telegram" || c.kind === "discord")) {
      return { kind: c.kind, token: c.token, chatId: owner.chatId, key, remote: true };
    }
  }
  return undefined;
}

/** Send a one-off message to a Discord channel via an incoming webhook. */
export async function discordSend(webhook: string, text: string): Promise<void> {
  await invoke("discord_send", { webhook, text });
}
