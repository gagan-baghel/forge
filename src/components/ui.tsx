import { type ReactNode, type ButtonHTMLAttributes, useEffect, useId } from "react";
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
    danger: "btn border border-danger/35 text-danger hover:bg-danger/10",
  };
  return (
    <button className={clsx(variants[variant], className)} {...props}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/* ---------------------------------- Card -------------------------------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  // Default padding unless the caller sets its own (p-0 for edge-to-edge lists).
  const custom = /(^|\s)p-\d/.test(className ?? "");
  return <div className={clsx("card", !custom && "p-5", className)}>{children}</div>;
}

/** Card title row: a heading, optional hint, optional right-side action. */
export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
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
    brand: "chip border-brand/25 bg-brand/10 text-brand-2",
    success: "chip border-success/25 bg-success/10 text-success",
    warn: "chip border-warn/25 bg-warn/10 text-warn",
    danger: "chip border-danger/25 bg-danger/10 text-danger",
  };
  return <span className={tones[tone]}>{children}</span>;
}

/* ------------------------------ Status dot ------------------------------ */
export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  const color =
    status === "live"
      ? "bg-success"
      : status === "ready"
        ? "bg-brand"
        : status === "paused"
          ? "bg-warn"
          : status === "error"
            ? "bg-danger"
            : "bg-ink-3";
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={clsx("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span className={clsx("relative inline-block h-2 w-2 rounded-full", color)} />
    </span>
  );
}

/* -------------------------------- Avatar -------------------------------- */
/** Earthy marks that sit well on both themes. */
const TINTS = ["#d9703a", "#c49a3c", "#7fa36b", "#6b8fa8", "#a8738f", "#b5654f", "#8a8f5a"];

/** Up to two initials: "Code Forge" → "CF", "scout" → "SC". */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return "·";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/**
 * An agent/pack mark: a monogram stamped on a tinted tile. The tint comes from
 * the pack colour when there is one, else from the name, so a mark is stable.
 */
export function Avatar({ name, tint, size = 32, className }: { name: string; tint?: string; size?: number; className?: string }) {
  const color = tint || tintFor(name);
  return (
    <span
      aria-hidden
      className={clsx("grid shrink-0 select-none place-items-center rounded-md font-mono font-medium", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        letterSpacing: "0.02em",
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------- Spinner ------------------------------- */
export function Spinner({ size = 16, label = "Working" }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" role="status" aria-label={label}>
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
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-md border border-dashed border-border-strong text-ink-3">
        <Icon name={icon} size={18} />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --------------------------------- Field -------------------------------- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/* -------------------------------- Toggle -------------------------------- */
/** An accessible on/off switch with a label and optional description. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={clsx("flex items-start justify-between gap-4", disabled && "opacity-50")}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {description && <div className="mt-0.5 text-xs text-ink-3">{description}</div>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-[5px] border transition-colors",
          checked ? "border-brand bg-brand" : "border-border-strong bg-surface-3",
        )}
      >
        <span
          className={clsx(
            "absolute left-0 top-0.5 h-3.5 w-3.5 rounded-[3px] bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
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

    // Return focus where it was. Without this, dismissing a dialog drops
    // keyboard focus to the top of the page and the user has to tab back.
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="anim-fade fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card anim-pop w-full p-5 shadow-soft"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="btn-ghost h-7 px-1.5" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ Tab bar -------------------------------- */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; icon?: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx("flex gap-0.5 overflow-x-auto", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] transition-colors",
            value === t.id ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="font-mono text-[10px] text-ink-3">{t.count}</span>}
          {value === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-brand" />}
        </button>
      ))}
    </div>
  );
}
