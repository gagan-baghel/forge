import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { MODELS } from "@/types/domain";

const STATUSES = ["draft", "ready", "live", "paused"] as const;

export function AgentsView() {
  const gaps = useGaps((s) => s.gaps);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [gapFilter, setGapFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const rows = useMemo(() => {
    return gaps
      .flatMap((g) => g.agents.map((a) => ({ agent: a, gap: g })))
      .filter(({ agent, gap }) => {
        if (gapFilter && gap.id !== gapFilter) return false;
        if (statusFilter && agent.status !== statusFilter) return false;
        return (agent.name + agent.role + gap.name).toLowerCase().includes(q.toLowerCase());
      });
  }, [gaps, q, gapFilter, statusFilter]);

  const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Every agent in your packs"
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
            <input className="input pl-8" placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={gapFilter} onChange={(e) => setGapFilter(e.target.value)}>
            <option value="">All packs</option>
            {gaps.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-ink-3">
            {rows.length} agent{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <Card className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon="agents"
              title={q || gapFilter || statusFilter ? "No matching agents" : "No agents yet"}
              body={q || gapFilter || statusFilter ? "Try different search or filters." : "Create a pack and add agents to it."}
              action={
                !q && !gapFilter && !statusFilter && (
                  <Button variant="primary" icon="store" onClick={() => navigate("/marketplace")}>
                    Browse Marketplace
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(({ agent, gap }) => (
                <li key={agent.id}>
                  <button
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <Avatar name={agent.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{agent.name}</div>
                      <div className="truncate text-xs text-ink-3">{agent.role}</div>
                    </div>
                    <span className="hidden w-40 truncate text-xs text-ink-2 md:block">{gap.name}</span>
                    <span className="hidden w-24 truncate text-right text-[11px] text-ink-3 sm:block">{modelLabel(agent.model)}</span>
                    <span className="flex w-20 items-center justify-end gap-1.5 text-xs capitalize text-ink-2">
                      <StatusDot status={agent.status} />
                      {agent.status}
                    </span>
                    <Icon name="chevron" size={14} className="text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
