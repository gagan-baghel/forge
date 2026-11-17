/**
 * Machine actions approved from the phone: each prompt arrives with Approve /
 * Allow 15 min / Deny. "Allow 15 min" opens a trust window for that chat —
 * actions then run without asking but are still announced, and anything
 * proposed after the turn read outside content asks again regardless.
 */
import { nanoid } from "nanoid";
import { UNTRUSTED_WARNING, type ApprovalRequest, type ApprovalResult, type ChannelRef } from "../approval";
import { errorMessage } from "../runError";
import { chatKeyOf, quiet, rt, sendText, updateText } from "./send";

export const TRUST_MS = 15 * 60_000;
/** A phone approval waits longer than a desktop one: the owner may be busy. */
export const REMOTE_APPROVAL_TIMEOUT_MS = 10 * 60_000;
const AUTO_APPROVED_BODY_CHARS = 600;

export type Decision = "ok" | "trust" | "no" | "timeout";

interface PendingApproval {
  ref: ChannelRef;
  title: string;
  messageId: string;
  resolve: (r: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingApproval>();

const LABELS: Record<Decision, string> = {
  ok: "✅ Approved",
  trust: "⏱ Approved — actions run without asking for 15 min (/lock to end)",
  no: "✖ Denied",
  timeout: "⌛ Timed out — not done",
};

const RESULTS: Record<Decision, ApprovalResult> = { ok: "ok", trust: "ok", no: "denied", timeout: "timeout" };

export function settle(id: string, decision: Decision): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  rt().removeApproval(id);
  if (decision === "trust") rt().setTrust(chatKeyOf(p.ref), Date.now() + TRUST_MS);
  const label = LABELS[decision];
  quiet(updateText(p.ref, p.messageId, `${label}: ${p.title}`));
  rt().log(p.ref.key, "approval", `${label}: ${p.title}`);
  p.resolve(RESULTS[decision]);
  return true;
}

/** Settle every open prompt matching `match` the same way. */
export function settleWhere(match: (ref: ChannelRef) => boolean, decision: Decision): void {
  for (const [id, p] of pending) if (match(p.ref)) settle(id, decision);
}

export function hasPendingFor(chatKey: string): boolean {
  return [...pending.values()].some((p) => chatKeyOf(p.ref) === chatKey);
}

/** Settle a button press, but only for a prompt sent to this very chat. */
export function settleFromChat(ref: ChannelRef, id: string, decision: Decision): void {
  const p = pending.get(id);
  if (p && chatKeyOf(p.ref) === chatKeyOf(ref)) settle(id, decision);
}

/** Ask the owner's phone. Registered as the remote approver on init. */
export async function remoteApprove(req: ApprovalRequest & { channel: ChannelRef }): Promise<ApprovalResult> {
  const ref = req.channel;
  const until = rt().trustUntil[chatKeyOf(ref)] ?? 0;

  // Inside a trust window: run, but say what ran. Outside content in this
  // turn voids the window — that is exactly when an injected instruction
  // would try to ride it.
  if (until > Date.now() && !req.turn?.untrusted) {
    const note = `▶ ${req.title.replace(/\?$/, "")}\n${req.body.slice(0, AUTO_APPROVED_BODY_CHARS)}`;
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
  } catch (e) {
    rt().log(ref.key, "system", `Couldn't deliver an approval prompt: ${errorMessage(e)}`);
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
export function typedAnswer(ref: ChannelRef, text: string): boolean {
  const decision: Decision | null = YES.test(text) ? "ok" : TRUST.test(text) ? "trust" : NO.test(text) ? "no" : null;
  if (!decision) return false;
  const mine = [...pending.entries()].filter(([, p]) => chatKeyOf(p.ref) === chatKeyOf(ref));
  const newest = mine[mine.length - 1];
  return newest ? settle(newest[0], decision) : false;
}
