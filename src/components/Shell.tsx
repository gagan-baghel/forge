import { type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "./Icon";
import { CommandPalette } from "./CommandPalette";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { platformName } from "@/lib/platform";

interface NavItem {
  label: string;
  to: string;
  icon: string;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { label: "Home", to: "/", icon: "home" },
      { label: "GAPs", to: "/gaps", icon: "grid" },
      { label: "Agents", to: "/agents", icon: "agents" },
      { label: "Brains", to: "/brains", icon: "brain" },
      { label: "Channels", to: "/channels", icon: "message" },
      { label: "Architect", to: "/architect", icon: "spark" },
    ],
  },
  {
    title: "Build",
    items: [
      { label: "Workshop", to: "/workshop", icon: "hammer" },
      { label: "Marketplace", to: "/marketplace", icon: "store" },
      { label: "Knowledge", to: "/knowledge", icon: "book" },
      { label: "Memory", to: "/memory", icon: "memory" },
      { label: "Schedules", to: "/schedules", icon: "clock" },
      { label: "Terminal", to: "/terminal", icon: "terminal" },
    ],
  },
  {
    title: "Insights",
    items: [
      { label: "Runs", to: "/runs", icon: "bolt" },
      { label: "Observability", to: "/observability", icon: "chart" },
      { label: "Integrations", to: "/integrations", icon: "plug" },
      { label: "Team", to: "/team", icon: "agents" },
      { label: "Settings", to: "/settings", icon: "settings" },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white shadow-glow">
        <span className="font-mono text-sm font-bold">F</span>
      </div>
      <div className="leading-tight">
        <div className="text-[0.95rem] font-semibold tracking-tight">Forge</div>
        <div className="text-[0.62rem] uppercase tracking-[0.16em] text-ink-3">agent workspace</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const gaps = useGaps((s) => s.gaps);
  const agents = gaps.flatMap((g) => g.agents);
  const live = agents.filter((a) => a.status === "live").length;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-surface">
      <Brand />
      <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new Event("forge:command-open"))}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-ink-3 transition-colors hover:border-brand/40"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[0.62rem]">⌘K</kbd>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
              {section.title}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-brand/12 font-medium text-ink"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={item.icon}
                      size={17}
                      className={isActive ? "text-brand-2" : "text-ink-3 group-hover:text-ink-2"}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.label === "Agents" && agents.length > 0 && (
                      <span className="font-mono text-[0.62rem] text-ink-3">
                        {live}/{agents.length}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <PlanCard />
    </aside>
  );
}

function PlanCard() {
  const apiKey = useSettings((s) => s.apiKey);
  const runtime = useSettings((s) => s.runtime);
  const navigate = useNavigate();

  const cc = runtime === "claude-code";
  const label = cc ? "Claude Code" : "Claude API";
  const detail = cc ? "subscription · nothing metered" : apiKey ? "key set" : "no key";
  const ok = cc || !!apiKey;

  return (
    <button
      onClick={() => navigate("/settings")}
      className="m-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-brand/40"
    >
      <div>
        <div className="text-xs font-medium text-ink">
          {label} · {platformName()}
        </div>
        <div className="text-[0.68rem] text-ink-3">{detail}</div>
      </div>
      <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-success" : "bg-warn")} />
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
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
    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-bg/80 px-7 py-5 backdrop-blur">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
