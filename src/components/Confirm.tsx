import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "./ui";
import { setApprover } from "@/lib/approval";

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
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (title: string, body?: string) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "notify"; title: string; body?: string };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Guards against a resolve firing twice (Escape then button, say).
  const settled = useRef(true);

  const close = useCallback((result: boolean) => {
    setPending((current) => {
      if (current?.kind === "confirm" && !settled.current) {
        settled.current = true;
        current.resolve(result);
      }
      return null;
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          settled.current = false;
          setPending({ kind: "confirm", opts, resolve });
        }),
      notify: (title, body) => setPending({ kind: "notify", title, body }),
    }),
    [],
  );

  // Let the agent tool layer reach this dialog; it lives outside React.
  useEffect(() => {
    setApprover(api.confirm);
    return () => setApprover(null);
  }, [api]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => close(false)}
        title={pending?.kind === "confirm" ? pending.opts.title : (pending?.title ?? "")}
      >
        {pending?.kind === "confirm" ? (
          <>
            {pending.opts.body && <p className="text-sm text-ink-2">{pending.opts.body}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => close(false)}>{pending.opts.cancelLabel ?? "Cancel"}</Button>
              <Button
                variant={pending.opts.danger === false ? "primary" : "danger"}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.opts.confirmLabel ?? "Delete"}
              </Button>
            </div>
          </>
        ) : (
          <>
            {pending?.body && <p className="text-sm text-ink-2">{pending.body}</p>}
            <div className="mt-6 flex justify-end">
              <Button variant="primary" autoFocus onClick={() => close(false)}>
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
