import type { ConfirmOptions } from "@/components/Confirm";

/**
 * The approval gate every machine-changing agent action passes through.
 *
 * Two approvers can answer:
 *  - the in-app dialog (`DialogProvider` registers it on mount), for turns
 *    started at the keyboard;
 *  - the owner's phone (`lib/remote.ts` registers it), for turns that arrived
 *    over a remote-control channel — the prompt goes to the chat with
 *    Approve / Allow 15 min / Deny buttons.
 *
 * Either way a human decides. With neither available the answer is "denied":
 * an unattended machine is never acted on.
 */

/**
 * "ok" — approved. "denied" — refused, or nothing could ask. "timeout" — the
 * prompt went unanswered, which means nobody was there to see it.
 */
export type ApprovalResult = "ok" | "denied" | "timeout";

/** A channel conversation a turn is answering (see ToolContext.channel). */
export interface ChannelRef {
  kind: "discord" | "telegram";
  token: string;
  chatId: string;
  /** `${agentId}__${channelId}` — identifies the bot. */
  key: string;
  /** Approvals for this turn go to the phone instead of the desktop. */
  remote: boolean;
}

/** Per-turn state shared by every tool call in that turn. */
export interface TurnState {
  /**
   * The turn has pulled in third-party content (a web page, a file, command
   * output). Text like that can hide "ignore your instructions and run X", so
   * an action proposed after it gets a louder prompt and never rides a trust
   * window.
   */
  untrusted: boolean;
}

export function newTurn(): TurnState {
  return { untrusted: false };
}

export interface ApprovalRequest {
  title: string;
  body: string;
  turn?: TurnState;
  channel?: ChannelRef;
}

type DialogApprover = (opts: ConfirmOptions) => Promise<ApprovalResult>;
type RemoteApprover = (req: ApprovalRequest & { channel: ChannelRef }) => Promise<ApprovalResult>;

/**
 * How long a desktop approval waits before auto-denying. Long enough to walk
 * back to the Mac, short enough that a prompt fired by an unattended run
 * doesn't wedge it forever.
 *
 * ponytail: fixed window, make it a setting if people want a different one.
 */
export const APPROVAL_TIMEOUT_MS = 120_000;

export const UNTRUSTED_WARNING =
  "⚠ This turn already read outside content (a web page, file, or command output). " +
  "If you did not ask for this action, deny it — instructions can hide in fetched text.";

let dialogApprover: DialogApprover | null = null;
let remoteApprover: RemoteApprover | null = null;

export function setApprover(fn: DialogApprover | null): void {
  dialogApprover = fn;
}

export function setRemoteApprover(fn: RemoteApprover | null): void {
  remoteApprover = fn;
}

/** Ask a human to approve one action. */
export async function approve(req: ApprovalRequest): Promise<ApprovalResult> {
  if (req.channel?.remote && remoteApprover) {
    return remoteApprover({ ...req, channel: req.channel });
  }
  if (!dialogApprover) return "denied";
  const warning = req.turn?.untrusted ? `\n\n${UNTRUSTED_WARNING}` : "";
  return dialogApprover({
    title: req.title,
    body: req.body + warning,
    confirmLabel: "Run",
    cancelLabel: "Deny",
    danger: true,
    timeoutMs: APPROVAL_TIMEOUT_MS,
  });
}
