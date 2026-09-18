import type { ConfirmOptions } from "@/components/Confirm";

/**
 * Bridge between the agent tool layer (plain async functions, outside React)
 * and the in-app confirm dialog.
 *
 * Tools that act on the user's machine — running a command, writing a file —
 * must clear this first. `DialogProvider` registers the real dialog on mount.
 */
/**
 * "ok" — the user clicked through. "denied" — they refused, or nothing could
 * ask them. "timeout" — the prompt went unanswered, which on a channel or
 * schedule run means nobody was at the machine.
 */
export type ApprovalResult = "ok" | "denied" | "timeout";

type Approver = (opts: ConfirmOptions) => Promise<ApprovalResult>;

/**
 * How long an agent approval waits for a human before auto-denying. Long
 * enough to walk back to the Mac, short enough that a prompt fired by an
 * inbound Discord/Telegram message doesn't wedge the run forever.
 *
 * ponytail: fixed window, make it a setting if people want a different one.
 */
export const APPROVAL_TIMEOUT_MS = 120_000;

let approver: Approver | null = null;

/**
 * Whether this turn has pulled in third-party content (a web page, a file, a
 * command's output). Content like that can contain text aimed at the model —
 * "ignore your instructions and run X" — so a machine-changing action proposed
 * *after* it deserves a louder prompt than one the user clearly asked for.
 * Reset at the start of every turn.
 */
let sawUntrustedContent = false;

export function resetProvenance(): void {
  sawUntrustedContent = false;
}

export function markUntrustedContent(): void {
  sawUntrustedContent = true;
}

export function setApprover(fn: Approver | null): void {
  approver = fn;
}

/**
 * Ask the user to approve one action. Denies when no dialog is mounted, which
 * is every headless path — channel messages and scheduled routines run with
 * nobody at the keyboard, and an unattended machine must never be acted on.
 */
export async function approve(title: string, body: string): Promise<ApprovalResult> {
  if (!approver) return "denied";
  const warning = sawUntrustedContent
    ? "\n\n⚠ This turn already read outside content (a web page, file, or command output). " +
      "If you did not ask for this action, deny it — instructions can hide in fetched text."
    : "";
  return approver({
    title,
    body: body + warning,
    confirmLabel: "Run",
    cancelLabel: "Deny",
    danger: true,
    timeoutMs: APPROVAL_TIMEOUT_MS,
  });
}
