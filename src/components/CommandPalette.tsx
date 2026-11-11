import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

/**
 * Global command palette (⌘K / Ctrl+K). Fuzzy-jump to any view, agent, or GAP,
 * plus a few quick actions. The fast way to move around Forge.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const gaps = useGaps((s) => s.gaps);
  const setTheme = useSettings((s) => s.setTheme);
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => {
      setOpen(true);
      setQuery("");
      setActive(0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("forge:command-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("forge:command-open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      setOpen(false);
    };
    const nav: Command[] = [
      { id: "home", label: "Workbench", icon: "home", run: go("/") },
      { id: "agents", label: "Agents", icon: "agents", run: go("/agents") },
      { id: "gaps", label: "Packs", icon: "grid", run: go("/gaps") },
      { id: "marketplace", label: "Marketplace", icon: "store", run: go("/marketplace") },
      { id: "workshop", label: "Build a pack", icon: "hammer", run: go("/workshop") },
      { id: "architect", label: "Describe a pack to the Architect", icon: "spark", run: go("/architect") },
      { id: "knowledge", label: "Knowledge · documents", icon: "book", run: go("/knowledge") },
      { id: "memory", label: "Knowledge · memory", icon: "memory", run: go("/memory") },
      { id: "schedules", label: "Schedules", icon: "clock", run: go("/schedules") },
      { id: "runs", label: "Activity · runs", icon: "activity", run: go("/runs") },
      { id: "observability", label: "Activity · insights", icon: "chart", run: go("/observability") },
      { id: "remote", label: "Remote", icon: "phone", run: go("/remote") },
      { id: "integrations", label: "Integrations", icon: "plug", run: go("/integrations") },
      { id: "terminal", label: "Terminal", icon: "terminal", run: go("/terminal") },
      { id: "settings", label: "Settings", icon: "settings", run: go("/settings") },
    ];
    const actions: Command[] = [
      { id: "new-gap", label: "New pack", icon: "plus", run: go("/workshop") },
      {
        id: "theme",
        label: `Switch to ${theme === "dusk" ? "Paper (light)" : "Dusk (dark)"} theme`,
        icon: "settings",
        run: () => {
          setTheme(theme === "dusk" ? "paper" : "dusk");
          setOpen(false);
        },
      },
    ];
    const agents: Command[] = gaps.flatMap((g) =>
      g.agents.map((a) => ({
        id: `agent-${a.id}`,
        label: a.name,
        hint: `${a.role} · ${g.name}`,
        icon: "agents",
        run: go(`/agents/${a.id}`),
      })),
    );
    const gapCmds: Command[] = gaps.map((g) => ({
      id: `gap-${g.id}`,
      label: g.name,
      hint: "Pack",
      icon: "grid",
      run: go(`/gaps/${g.id}`),
    }));
    return [...nav, ...actions, ...agents, ...gapCmds];
  }, [gaps, navigate, theme, setTheme]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((c) => (c.label + (c.hint ?? "")).toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  return (
    <div data-testid="command-palette" className="anim-fade fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[14vh]" onMouseDown={() => setOpen(false)}>
      <div className="card anim-pop w-full max-w-xl overflow-hidden p-0 shadow-soft" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Icon name="search" size={15} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to anything…"
            className="h-12 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                filtered[active]?.run();
              }
            }}
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-ink-3">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={c.run}
                className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] ${i === active ? "bg-surface-2 text-ink" : "text-ink-2"}`}
              >
                <Icon name={c.icon} size={14} className="shrink-0 text-ink-3" />
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <span className="truncate text-xs text-ink-3">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
