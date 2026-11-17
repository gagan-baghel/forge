import { createContext, useContext } from "react";
import type { ConfirmOptions } from "@/components/Confirm";

export interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (title: string, body?: string) => void;
}

export const DialogContext = createContext<DialogApi | null>(null);

/** `const { confirm, notify } = useDialog();` — both are safe on every platform. */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>.");
  return ctx;
}
