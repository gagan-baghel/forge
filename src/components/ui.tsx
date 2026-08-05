import { type ReactNode, type ButtonHTMLAttributes, useEffect } from "react";
import clsx from "clsx";
import { Icon } from "./Icon";

/* --------------------------------- Button ------------------------------- */
type Variant = "primary" | "ghost" | "outline" | "danger";
export function Button({
  variant = "outline",
  className,
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string }) {
  const variants: Record<Variant, string> = {
    primary: "btn-primary",
    ghost: "btn-ghost",
    outline: "btn-outline",
    danger: "btn border border-danger/40 text-danger hover:bg-danger/10",
  };
  return (
    <button className={clsx(variants[variant], className)} {...props}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/* ---------------------------------- Card -------------------------------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card p-5", className)}>{children}</div>;
}

/* --------------------------------- Badge -------------------------------- */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warn" | "danger";
}) {
  const tones: Record<string, string> = {
    neutral: "chip",
    brand: "chip border-brand/30 bg-brand/10 text-brand-2",
    success: "chip border-success/30 bg-success/10 text-success",
    warn: "chip border-warn/30 bg-warn/10 text-warn",
    danger: "chip border-danger/30 bg-danger/10 text-danger",
  };
  return <span className={tones[tone]}>{children}</span>;
}

/* ------------------------------ Status dot ------------------------------ */
export function StatusDot({ status }: { status: string }) {
  const color =
    status === "live"
      ? "bg-success"
      : status === "ready"
        ? "bg-brand"
        : status === "paused"
          ? "bg-warn"
          : "bg-ink-3";
  return <span className={clsx("inline-block w-2 h-2 rounded-full", color)} />;
}

/* -------------------------------- Spinner ------------------------------- */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.2" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------ Empty state ----------------------------- */
export function EmptyState({
  icon = "grid",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-surface-2 grid place-items-center text-ink-3 mb-4">
        <Icon name={icon} size={26} />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="text-sm text-ink-2 mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------- Field -------------------------------- */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/* --------------------------------- Modal -------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="card w-full p-6 shadow-soft"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
