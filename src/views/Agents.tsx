import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, StatusDot } from "@/components/ui";
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
        subtitle="Every agent across your installed GAPs"
        actions={
          <Button variant="primary" icon="plus" onClick={() => navigate("/gaps")}>
            New agent
          </Button>
        }
      />
      <div className="p-7">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input pl-9"
              placeholder="Search agents…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input w-auto" value={gapFilter} onChange={(e) => setGapFilter(e.target.value)}>
            <option value="">All GAPs</option>
            {gaps.map((g) => (
              <option key={g.id} value={g.id}>
                {g.emoji} {g.name}
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
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="agents"
            title={q || gapFilter || statusFilter ? "No matching agents" : "No agents yet"}
            body={q || gapFilter || statusFilter ? "Try different search or filters." : "Create a GAP and add agents to it."}
            action={
              !q && !gapFilter && !statusFilter && (
                <Button variant="primary" icon="store" onClick={() => navigate("/marketplace")}>
                  Browse Marketplace
                </Button>
              )
            }
          />
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-border">
              {rows.map(({ agent, gap }) => (
                <button
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="text-2xl">{agent.emoji}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{agent.name}</div>
                    <div className="text-xs text-ink-3">{agent.role}</div>
                  </div>
                  <Badge>{gap.emoji} {gap.name}</Badge>
                  <Badge tone="brand">{modelLabel(agent.model)}</Badge>
                  <div className="flex w-20 items-center justify-end gap-1.5 text-xs text-ink-2">
                    <StatusDot status={agent.status} />
                    {agent.status}
                  </div>
                  <Icon name="chevron" size={16} className="text-ink-3" />
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
