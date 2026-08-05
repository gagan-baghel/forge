import { useMemo } from "react";
import { PageHeader } from "@/components/Shell";
import { Card, EmptyState } from "@/components/ui";
import { useRuns } from "@/stores/runs";
import { useGaps } from "@/stores/gaps";
import { fmtTokens } from "@/lib/format";

export function ObservabilityView() {
  const runs = useRuns((s) => s.runs);
  const gaps = useGaps((s) => s.gaps);

  const stats = useMemo(() => {
    const tokens = runs.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);
    const errors = runs.filter((r) => r.status === "error").length;
    const errorRate = runs.length ? (errors / runs.length) * 100 : 0;

    // Token usage per agent.
    const byAgent: Record<string, { name: string; tokens: number }> = {};
    for (const r of runs) {
      byAgent[r.agentId] ??= { name: r.agentName, tokens: 0 };
      byAgent[r.agentId].tokens += r.tokensIn + r.tokensOut;
    }
    const top = Object.values(byAgent).sort((a, b) => b.tokens - a.tokens).slice(0, 8);

    // Last-14-day run counts.
    const days: { day: string; runs: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = d.getTime() + 86400000;
      const c = runs.filter((r) => r.startedAt >= d.getTime() && r.startedAt < next).length;
      days.push({ day: d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), runs: c });
    }

    return { tokens, errorRate, top, days };
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div>
        <PageHeader title="Observability" subtitle="Throughput and reliability across your workspace" />
        <div className="p-7">
          <EmptyState icon="chart" title="Nothing to chart yet" body="Run some agents and analytics will appear here." />
        </div>
      </div>
    );
  }

  const maxDay = Math.max(...stats.days.map((d) => d.runs), 1);
  const maxAgent = Math.max(...stats.top.map((a) => a.tokens), 1);

  return (
    <div>
      <PageHeader title="Observability" subtitle="Throughput and reliability across your workspace" />
      <div className="space-y-6 p-7">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["Total runs", String(runs.length)],
            ["Total tokens", fmtTokens(stats.tokens)],
            ["Agents", String(gaps.reduce((a, g) => a + g.agents.length, 0))],
            ["Error rate", `${stats.errorRate.toFixed(0)}%`],
          ].map(([l, v]) => (
            <Card key={l}>
              <div className="text-2xl font-semibold">{v}</div>
              <div className="text-xs text-ink-3">{l}</div>
            </Card>
          ))}
        </div>

        <Card>
          <h3 className="mb-4 font-semibold">Runs · last 14 days</h3>
          <div className="flex items-end gap-2" style={{ height: 160 }}>
            {stats.days.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-brand/70"
                    style={{ height: `${(d.runs / maxDay) * 100}%`, minHeight: d.runs > 0 ? 4 : 0 }}
                    title={`${d.runs} run${d.runs === 1 ? "" : "s"}`}
                  />
                </div>
                <span className="text-[0.6rem] text-ink-3">{d.day}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold">Top agents by token usage</h3>
          <div className="space-y-3">
            {stats.top.map((a) => (
              <div key={a.name} className="flex items-center gap-3">
                <span className="w-32 truncate text-sm">{a.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(a.tokens / maxAgent) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-xs text-ink-2">{fmtTokens(a.tokens)}</span>
              </div>
            ))}
          </div>
        </Card>

        <p className="text-center text-xs text-ink-3">
          {gaps.length} GAP{gaps.length === 1 ? "" : "s"} · {gaps.reduce((a, g) => a + g.agents.length, 0)} agents tracked
        </p>
      </div>
    </div>
  );
}
