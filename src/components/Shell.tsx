import { type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
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
}

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: "Home", to: "/", icon: "home" },
      { label: "Agents", to: "/agents", icon: "agents" },
      { label: "GAPs", to: "/gaps", icon: "grid" },
      { label: "Remote", to: "/remote", icon: "phone" },
    ],
  },
  {
    title: "Build",
    items: [
      { label: "Workshop", to: "/workshop", icon: "hammer" },
      { label: "Architect", to: "/architect", icon: "spark" },
      { label: "Brains", to: "/brains", icon: "brain" },
      { label: "Knowledge", to: "/knowledge", icon: "book" },
      { label: "Memory", to: "/memory", icon: "memory" },
      { label: "Marketplace", to: "/marketplace", icon: "store" },
    ],
  },
  {
    title: "Operate",
    items: [
      { label: "Schedules", to: "/schedules", icon: "clock" },
      { label: "Runs", to: "/runs", icon: "activity" },
      { label: "Observability", to: "/observability", icon: "chart" },
      { label: "Terminal", to: "/terminal", icon: "terminal" },
      { label: "Integrations", to: "/integrations", icon: "plug" },
      { label: "Team", to: "/team", icon: "user" },
    ],
  },
];

/** The Forge mark: an anvil-cut square with a spark. */
export function ForgeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="rgb(var(--primary))" />
      <path d="M7 15.5h10M9 15.5l1-5h4l1 5" stroke="rgb(var(--on-primary))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16.5" cy="7.5" r="1.6" fill="rgb(var(--accent))" />
    </svg>
  );
}

function Brand() {
  return (
    // On desktop the window's traffic lights sit over this corner.
    <div className={clsx("flex h-12 items-center gap-2.5", isDesktop() ? "pl-[84px] pr-4" : "px-4")} data-tauri-drag-region>
      <ForgeMark />
      <span className="text-[14px] font-semibold tracking-tight">Forge</span>
    </div>
  );
}

function NavRow({ item, badge }: { item: NavItem; badge?: ReactNode }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        clsx(
          "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
          isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={item.icon} size={15} className={isActive ? "text-ink" : "text-ink-3 group-hover:text-ink-2"} />
          <span className="flex-1 truncate">{item.label}</span>
          {badge}
        </>
      )}
    </NavLink>
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
      return <span className="font-mono text-[10px] text-ink-3">{agents.length}</span>;
    if (label === "Remote" && approvals > 0)
      return <span className="rounded bg-warn/15 px-1 font-mono text-[10px] text-warn">{approvals}</span>;
    if (label === "Remote" && liveBots > 0)
      return <span className="h-1.5 w-1.5 rounded-full bg-success" aria-label={`${liveBots} live`} />;
    return undefined;
  };

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-border bg-surface/60">
      <Brand />
      <div className="px-3 pb-3">
        <button
          onClick={() => window.dispatchEvent(new Event("forge:command-open"))}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-bg px-2 text-[13px] text-ink-3 transition-colors hover:border-border-strong"
        >
          <Icon name="search" size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SECTIONS.map((section, i) => (
          <div key={section.title ?? i} className="space-y-px">
            {section.title && <div className="px-2 pb-1 text-[11px] font-medium text-ink-3">{section.title}</div>}
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
      className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-warn")} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-xs font-medium text-ink-2">{label}</div>
        <div className="truncate text-[11px] text-ink-3">
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
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between gap-4 border-b border-border bg-bg/85 px-8 py-3 backdrop-blur"
      data-tauri-drag-region
    >
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Standard page body width and padding. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-6xl px-8 py-6", className)}>{children}</div>;
}
