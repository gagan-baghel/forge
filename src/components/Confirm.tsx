import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "./ui";
import { setApprover, type ApprovalResult } from "@/lib/approval";

/**
 * In-app confirm / notify dialogs.
 *
 * The desktop webview implements no WKUIDelegate JS-panel handlers, so
 * `window.confirm` resolves false and `window.alert` is a no-op — every
 * destructive guard would silently block. These use the app's own Modal
 * instead, so they behave identically on desktop and web.
 */

export interface ConfirmOptions {
  title: string;
  /** Body copy. Spell out what is lost — these guard destructive actions. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Defaults to true. */
  danger?: boolean;
  /**
   * Auto-deny after this long with no answer. Set for agent approvals, which
   * can fire on an unattended machine; plain UI confirms leave it unset and
   * wait indefinitely.
   */
  timeoutMs?: number;
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (title: string, body?: string) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (result: ApprovalResult) => void }
  | { kind: "notify"; title: string; body?: string };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Guards against a resolve firing twice (Escape then button, say).
  const settled = useRef(true);

  const close = useCallback((result: ApprovalResult) => {
    setPending((current) => {
      if (current?.kind === "confirm" && !settled.current) {
        settled.current = true;
        current.resolve(result);
      }
      return null;
    });
  }, []);

  /** Resolves "ok" / "denied", or "timeout" when opts.timeoutMs elapses first. */
  const ask = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<ApprovalResult>((resolve) => {
        settled.current = false;
        setPending({ kind: "confirm", opts, resolve });
      }),
    [],
  );

  const api = useMemo<DialogApi>(
    () => ({
      confirm: async (opts) => (await ask(opts)) === "ok",
      notify: (title, body) => setPending({ kind: "notify", title, body }),
    }),
    [ask],
  );

  /**
   * An unanswered approval used to hang forever, which left a channel or
   * schedule run wedged with nobody at the keyboard to click. Time it out and
   * report that distinctly, so the caller can say "nobody answered" rather
   * than claim the user refused.
   */
  useEffect(() => {
    if (pending?.kind !== "confirm" || !pending.opts.timeoutMs) return;
    const timer = setTimeout(() => close("timeout"), pending.opts.timeoutMs);
    return () => clearTimeout(timer);
  }, [pending, close]);

  // Let the agent tool layer reach this dialog; it lives outside React.
  useEffect(() => {
    setApprover(ask);
    return () => setApprover(null);
  }, [ask]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => close("denied")}
        title={pending?.kind === "confirm" ? pending.opts.title : (pending?.title ?? "")}
      >
        {pending?.kind === "confirm" ? (
          <>
            {pending.opts.body && <p className="text-sm text-ink-2">{pending.opts.body}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => close("denied")}>{pending.opts.cancelLabel ?? "Cancel"}</Button>
              <Button
                variant={pending.opts.danger === false ? "primary" : "danger"}
                autoFocus
                onClick={() => close("ok")}
              >
                {pending.opts.confirmLabel ?? "Delete"}
              </Button>
            </div>
          </>
        ) : (
          <>
            {pending?.body && <p className="text-sm text-ink-2">{pending.body}</p>}
            <div className="mt-6 flex justify-end">
              <Button variant="primary" autoFocus onClick={() => close("denied")}>
                OK
              </Button>
            </div>
          </>
        )}
      </Modal>
    </DialogContext.Provider>
  );
}

/** `const { confirm, notify } = useDialog();` — both are safe on every platform. */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>.");
  return ctx;
}
