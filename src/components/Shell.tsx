import { type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "./Icon";
import { CommandPalette } from "./CommandPalette";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { useChannelRuntime } from "@/stores/channelRuntime";
import { isDesktop, platformName } from "@/lib/platform";

interface NavItem {
  label: string;
  to: string;
  icon: string;
  /** Other routes that belong to this item; it stays highlighted on them. */
  also?: string[];
}

/**
 * Nine places, not seventeen. Pages that answer the same question share one
 * item and switch with tabs (see `TABS`); creation flows (Workshop, Architect)
 * are actions on the Packs page, not destinations.
 */
const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: "Workbench", to: "/", icon: "home" },
      { label: "Agents", to: "/agents", icon: "agents" },
      { label: "Packs", to: "/gaps", icon: "grid", also: ["/marketplace", "/workshop", "/architect"] },
      { label: "Knowledge", to: "/knowledge", icon: "book", also: ["/memory"] },
    ],
  },
  {
    title: "Run",
    items: [
      { label: "Schedules", to: "/schedules", icon: "clock" },
      { label: "Activity", to: "/runs", icon: "activity", also: ["/observability"] },
      { label: "Remote", to: "/remote", icon: "phone" },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Integrations", to: "/integrations", icon: "plug" },
      { label: "Terminal", to: "/terminal", icon: "terminal" },
    ],
  },
];

/** Sibling pages shown as tabs in the page header. */
export const TABS = {
  packs: [
    { label: "My packs", to: "/gaps" },
    { label: "Marketplace", to: "/marketplace" },
  ],
  knowledge: [
    { label: "Documents", to: "/knowledge" },
    { label: "Memory", to: "/memory" },
  ],
  activity: [
    { label: "Runs", to: "/runs" },
    { label: "Insights", to: "/observability" },
  ],
} satisfies Record<string, { label: string; to: string }[]>;

function isActive(item: NavItem, path: string): boolean {
  const under = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`));
  return under(item.to) || (item.also ?? []).some(under);
}

/** The Forge mark: an anvil on a square plate, with one ember spark. */
export function ForgeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="rgb(var(--primary))" />
      <path d="M6 9.5h10.5l-2 2.5v3.5h-6v-3.5L6 9.5zM7.5 18h9" stroke="rgb(var(--on-primary))" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      <rect x="17" y="4.5" width="2.6" height="2.6" fill="rgb(var(--accent))" />
    </svg>
  );
}

function Brand() {
  return (
    // On desktop the window's traffic lights sit over this corner.
    <div className={clsx("flex h-12 items-center gap-2.5", isDesktop() ? "pl-[84px] pr-4" : "px-4")} data-tauri-drag-region>
      <ForgeMark />
      <span className="text-[14.5px] font-semibold tracking-tight">Forge</span>
      <span className="ml-auto font-mono text-[10px] text-ink-3">v{__APP_VERSION__}</span>
    </div>
  );
}

function NavRow({ item, badge }: { item: NavItem; badge?: ReactNode }) {
  const active = isActive(item, useLocation().pathname);
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group relative flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        active ? "bg-surface-2/70 font-medium text-ink" : "text-ink-2 hover:text-ink",
      )}
    >
      {active && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[2px] bg-brand" />}
      <Icon name={item.icon} size={15} className={active ? "text-brand" : "text-ink-3 group-hover:text-ink-2"} />
      <span className="flex-1 truncate">{item.label}</span>
      {badge}
    </Link>
  );
}

function Sidebar() {
  const gaps = useGaps((s) => s.gaps);
  const running = useChannelRuntime((s) => s.running);
  const approvals = useChannelRuntime((s) => s.approvals.length);
  const agents = gaps.flatMap((g) => g.agents);
  const liveBots = Object.values(running).filter(Boolean).length;

  const badgeFor = (label: string) => {
    if (label === "Agents" && agents.length > 0)
      return <span className="num text-[10.5px] text-ink-3">{agents.length}</span>;
    if (label === "Remote" && approvals > 0)
      return <span className="rounded bg-warn/15 px-1 font-mono text-[10px] text-warn">{approvals}</span>;
    if (label === "Remote" && liveBots > 0)
      return <span className="h-1.5 w-1.5 rounded-full bg-success" aria-label={`${liveBots} live`} />;
    return undefined;
  };

  return (
    <aside className="flex h-full w-[228px] shrink-0 flex-col border-r border-border bg-bg">
      <Brand />
      <div className="px-3 pb-3">
        <button
          onClick={() => window.dispatchEvent(new Event("forge:command-open"))}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2 text-[13px] text-ink-3 transition-colors hover:border-border-strong hover:text-ink-2"
        >
          <Icon name="search" size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SECTIONS.map((section, i) => (
          <div key={section.title ?? i} className="space-y-px">
            {section.title && <div className="label px-2 pb-1.5">{section.title}</div>}
            {section.items.map((item) => (
              <NavRow key={item.to} item={item} badge={badgeFor(item.label)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-px border-t border-border p-3">
        <NavRow item={{ label: "Settings", to: "/settings", icon: "settings" }} />
        <RuntimeCard />
      </div>
    </aside>
  );
}

function RuntimeCard() {
  const apiKey = useSettings((s) => s.apiKey);
  const runtime = useSettings((s) => s.runtime);
  const navigate = useNavigate();

  const cc = runtime === "claude-code";
  const label = cc ? "Claude Code" : "Claude API";
  const detail = cc ? "Subscription · not metered" : apiKey ? "API key set" : "No API key";
  const ok = cc || !!apiKey;

  return (
    <button
      onClick={() => navigate("/settings")}
      className="mt-1 flex w-full items-center gap-2.5 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:border-border-strong"
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-warn")} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-xs font-medium text-ink-2">{label}</div>
        <div className="truncate font-mono text-[10px] text-ink-3">
          {detail} · {platformName()}
        </div>
      </div>
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}

/** Standard page header used across views. */
export function PageHeader({
  title,
  subtitle,
  actions,
  tabs,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Sibling pages, from `TABS`; rendered as a tab row under the title. */
  tabs?: { label: string; to: string }[];
  /** Where "up" is from a detail page. Explicit, never history: a page opened
   *  from search or a fresh window has no history to go back to. */
  back?: { to: string; label: string };
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-bg px-8" data-tauri-drag-region>
      <div className={clsx("flex min-h-[64px] items-center justify-between gap-4", tabs ? "pt-3" : "py-3")}>
        <div className="min-w-0">
          {back && <BackLink {...back} />}
          <h1 className="truncate text-[18px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs && (
        <nav className="-mb-px mt-1 flex gap-5" aria-label={`${title} sections`}>
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end
              className={({ isActive }) =>
                clsx(
                  "border-b-2 pb-2.5 text-[13px] transition-colors",
                  isActive ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

/** "← Packs": the way up from a detail page. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="group mb-0.5 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
      <Icon name="chevron" size={12} className="rotate-180 transition-transform group-hover:-translate-x-0.5" />
      {label}
    </Link>
  );
}

/** Standard page body width and padding. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-6xl px-8 py-6", className)}>{children}</div>;
}
