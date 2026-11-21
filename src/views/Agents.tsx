import { useMemo, useState } from "react";
import { BotFace, BotStack } from "@/components/BotFace";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Button, Card, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { MODELS, type Gap } from "@/types/domain";

/**
 * Every pack, each opening onto its agents. Clicking a pack talks to the whole
 * pack (or straight to its agent when it has only one); clicking an agent
 * talks to that agent alone.
 */
export function AgentsView() {
  const gaps = useGaps((s) => s.gaps);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      gaps
        .map((gap) => {
          const packHit = gap.name.toLowerCase().includes(needle);
          const agents = gap.agents.filter((a) => packHit || (a.name + a.role).toLowerCase().includes(needle));
          return { gap, agents, agentHit: !packHit && agents.length > 0 };
        })
        .filter((r) => r.agents.length > 0 || r.gap.name.toLowerCase().includes(needle)),
    [gaps, needle],
  );
  const agentCount = gaps.reduce((n, g) => n + g.agents.length, 0);
  const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
  // One agent: its own chat. None: the pack page, to add one. Several: the pack chat.
  const openPack = (gap: Gap) =>
    navigate(
      gap.agents.length === 0
        ? `/gaps/${gap.id}`
        : gap.agents.length === 1
          ? `/agents/${gap.agents[0].id}`
          : `/agents/pack/${gap.id}`,
    );

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Talk to a pack, or open it to talk to one agent"
        actions={
          <Button variant="primary" icon="plus" onClick={() => navigate("/gaps")}>
            New agent
          </Button>
        }
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input pl-8"
              placeholder="Search packs and agents…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="ml-auto text-xs text-ink-3">
            {gaps.length} pack{gaps.length === 1 ? "" : "s"} · {agentCount} agent{agentCount === 1 ? "" : "s"}
          </span>
        </div>

        <Card className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon="agents"
              title={q ? "Nothing matches" : "No packs yet"}
              body={q ? "Try a different search." : "Create a pack and add agents to it."}
              action={
                !q && (
                  <Button variant="primary" icon="store" onClick={() => navigate("/marketplace")}>
                    Browse Marketplace
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(({ gap, agents, agentHit }) => {
                // A search that matched an agent opens its pack to show it.
                const expanded = open[gap.id] ?? agentHit;
                return (
                  <li key={gap.id}>
                    <div className="flex items-center transition-colors hover:bg-surface-2/50">
                      <button
                        onClick={() => openPack(gap)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-5 text-left"
                        title={
                          gap.agents.length > 1
                            ? `Chat with ${gap.name}`
                            : `Chat with ${gap.agents[0]?.name ?? gap.name}`
                        }
                      >
                        <BotStack agents={gap.agents} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{gap.name}</div>
                          <div className="truncate text-xs text-ink-3">
                            {gap.agents.map((a) => a.name).join(", ") || "No agents yet"}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => setOpen((o) => ({ ...o, [gap.id]: !expanded }))}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} agents in ${gap.name}`}
                        className="flex h-full items-center gap-2 py-2.5 pl-3 pr-5 text-xs text-ink-3 hover:text-ink"
                      >
                        <span className="font-mono">
                          {gap.agents.length} agent{gap.agents.length === 1 ? "" : "s"}
                        </span>
                        <Icon
                          name="chevron"
                          size={14}
                          className={clsx("transition-transform", expanded && "rotate-90")}
                        />
                      </button>
                    </div>
                    {expanded && (
                      <ul className="border-t border-border bg-surface/40">
                        {agents.map((agent) => (
                          <li key={agent.id}>
                            <button
                              onClick={() => navigate(`/agents/${agent.id}`)}
                              className="flex w-full items-center gap-3 py-2 pl-12 pr-5 text-left transition-colors hover:bg-surface-2/50"
                            >
                              <BotFace name={agent.name} size={26} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px]">{agent.name}</div>
                                <div className="truncate text-xs text-ink-3">{agent.role}</div>
                              </div>
                              <span className="hidden w-24 truncate text-right text-[11px] text-ink-3 sm:block">
                                {modelLabel(agent.model)}
                              </span>
                              <span className="flex w-20 items-center justify-end gap-1.5 text-xs capitalize text-ink-2">
                                <StatusDot status={agent.status} />
                                {agent.status}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
