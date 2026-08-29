import type { ConfirmOptions } from "@/components/Confirm";

/**
 * Bridge between the agent tool layer (plain async functions, outside React)
 * and the in-app confirm dialog.
 *
 * Tools that act on the user's machine — running a command, writing a file —
 * must clear this first. `DialogProvider` registers the real dialog on mount.
 */
type Approver = (opts: ConfirmOptions) => Promise<boolean>;

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
export async function approve(title: string, body: string): Promise<boolean> {
  if (!approver) return false;
  const warning = sawUntrustedContent
    ? "\n\n⚠ This turn already read outside content (a web page, file, or command output). " +
      "If you did not ask for this action, deny it — instructions can hide in fetched text."
    : "";
  return approver({ title, body: body + warning, confirmLabel: "Run", cancelLabel: "Deny", danger: true });
}
