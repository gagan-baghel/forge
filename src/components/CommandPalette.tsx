import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { useGaps } from "@/stores/gaps";
import { useBrains } from "@/stores/brains";
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
  const brains = useBrains((s) => s.brains);
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
      { id: "home", label: "Home", icon: "home", run: go("/") },
      { id: "gaps", label: "GAPs", icon: "grid", run: go("/gaps") },
      { id: "agents", label: "Agents", icon: "agents", run: go("/agents") },
      { id: "brains", label: "Brains", icon: "brain", run: go("/brains") },
      { id: "workshop", label: "Workshop", icon: "hammer", run: go("/workshop") },
      { id: "channels", label: "Channels", icon: "message", run: go("/channels") },
      { id: "architect", label: "Architect", icon: "spark", run: go("/architect") },
      { id: "marketplace", label: "Marketplace", icon: "store", run: go("/marketplace") },
      { id: "knowledge", label: "Knowledge", icon: "book", run: go("/knowledge") },
      { id: "memory", label: "Memory", icon: "memory", run: go("/memory") },
      { id: "schedules", label: "Schedules", icon: "clock", run: go("/schedules") },
      { id: "terminal", label: "Terminal", icon: "terminal", run: go("/terminal") },
      { id: "runs", label: "Runs", icon: "bolt", run: go("/runs") },
      { id: "observability", label: "Observability", icon: "chart", run: go("/observability") },
      { id: "integrations", label: "Integrations", icon: "plug", run: go("/integrations") },
      { id: "team", label: "Team", icon: "agents", run: go("/team") },
      { id: "settings", label: "Settings", icon: "settings", run: go("/settings") },
    ];
    const actions: Command[] = [
      { id: "new-gap", label: "Create new GAP", icon: "plus", run: go("/gaps") },
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
      hint: "GAP",
      icon: "grid",
      run: go(`/gaps/${g.id}`),
    }));
    const brainCmds: Command[] = brains.map((b) => ({
      id: `brain-${b.id}`,
      label: b.name,
      hint: "Brain",
      icon: "brain",
      run: go(`/brains/${b.id}`),
    }));
    return [...nav, ...actions, ...agents, ...gapCmds, ...brainCmds];
  }, [gaps, brains, navigate, theme, setTheme]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((c) => (c.label + (c.hint ?? "")).toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  return (
    <div data-testid="command-palette" className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div className="card w-full max-w-lg overflow-hidden p-0 shadow-soft" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Icon name="search" size={16} className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to anything…"
            className="w-full bg-transparent py-3.5 text-sm outline-none"
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
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-ink-3">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-3">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={c.run}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? "bg-brand/12" : ""}`}
              >
                <Icon name={c.icon} size={15} className="text-ink-3" />
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="text-xs text-ink-3">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
