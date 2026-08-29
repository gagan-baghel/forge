import { useMemo } from "react";
import { PageHeader } from "@/components/Shell";
import { Card, EmptyState } from "@/components/ui";
import { useRuns } from "@/stores/runs";
import { useGaps } from "@/stores/gaps";
import { fmtUsd, fmtTokens } from "@/lib/format";
import { ERROR_LABELS, type ErrorKind } from "@/lib/runError";
import { MODELS } from "@/types/domain";

export function ObservabilityView() {
  const runs = useRuns((s) => s.runs);
  const gaps = useGaps((s) => s.gaps);

  const stats = useMemo(() => {
    const cost = runs.reduce((a, r) => a + r.costUsd, 0);
    const tokens = runs.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);
    const errors = runs.filter((r) => r.status === "error").length;
    const errorRate = runs.length ? (errors / runs.length) * 100 : 0;

    // Spend per agent.
    const byAgent: Record<string, { name: string; cost: number }> = {};
    for (const r of runs) {
      byAgent[r.agentId] ??= { name: r.agentName, cost: 0 };
      byAgent[r.agentId].cost += r.costUsd;
    }
    const top = Object.values(byAgent).sort((a, b) => b.cost - a.cost).slice(0, 8);

    // Last-14-day spend buckets.
    const days: { day: string; cost: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = d.getTime() + 86400000;
      const c = runs.filter((r) => r.startedAt >= d.getTime() && r.startedAt < next).reduce((a, r) => a + r.costUsd, 0);
      days.push({ day: d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), cost: c });
    }

    // Why runs fail, not just how often — a rate limit and an auth failure
    // need completely different responses.
    const failures: Record<string, number> = {};
    for (const r of runs) {
      if (r.status !== "error") continue;
      const kind = r.errorKind ?? "other";
      failures[kind] = (failures[kind] ?? 0) + 1;
    }
    const failureMix = Object.entries(failures).sort((a, b) => b[1] - a[1]);

    // Spend per model, so an expensive default is visible.
    const byModel: Record<string, number> = {};
    for (const r of runs) {
      if (!r.model) continue;
      byModel[r.model] = (byModel[r.model] ?? 0) + r.costUsd;
    }
    const models = Object.entries(byModel).sort((a, b) => b[1] - a[1]);

    return { cost, tokens, errorRate, top, days, failureMix, models };
  }, [runs]);

  if (runs.length === 0) {
    return (
      <div>
        <PageHeader title="Observability" subtitle="Spend, throughput and reliability across your workspace" />
        <div className="p-7">
          <EmptyState icon="chart" title="Nothing to chart yet" body="Run some agents and analytics will appear here." />
        </div>
      </div>
    );
  }

  const maxDay = Math.max(...stats.days.map((d) => d.cost), 0.0001);
  const maxAgent = Math.max(...stats.top.map((a) => a.cost), 0.0001);

  return (
    <div>
      <PageHeader title="Observability" subtitle="Spend, throughput and reliability across your workspace" />
      <div className="space-y-6 p-7">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["Total spend", fmtUsd(stats.cost)],
            ["Total tokens", fmtTokens(stats.tokens)],
            ["Runs", String(runs.length)],
            ["Error rate", `${stats.errorRate.toFixed(0)}%`],
          ].map(([l, v]) => (
            <Card key={l}>
              <div className="text-2xl font-semibold">{v}</div>
              <div className="text-xs text-ink-3">{l}</div>
            </Card>
          ))}
        </div>

        <Card>
          <h3 className="mb-4 font-semibold">Spend · last 14 days</h3>
          <div className="flex items-end gap-2" style={{ height: 160 }}>
            {stats.days.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-brand/70"
                    style={{ height: `${(d.cost / maxDay) * 100}%`, minHeight: d.cost > 0 ? 4 : 0 }}
                    title={fmtUsd(d.cost)}
                  />
                </div>
                <span className="text-[0.6rem] text-ink-3">{d.day}</span>
              </div>
            ))}
          </div>
        </Card>

        {stats.failureMix.length > 0 && (
          <Card>
            <h3 className="mb-4 font-semibold">Why runs failed</h3>
            <div className="space-y-2">
              {stats.failureMix.map(([kind, n]) => (
                <div key={kind} className="flex items-center gap-3">
                  <span className="w-32 text-sm">{ERROR_LABELS[kind as ErrorKind] ?? kind}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-danger"
                      style={{ width: `${(n / Math.max(...stats.failureMix.map((f) => f[1]))) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-ink-2">{n}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {stats.models.length > 0 && (
          <Card>
            <h3 className="mb-4 font-semibold">Spend by model</h3>
            <div className="space-y-3">
              {stats.models.map(([model, cost]) => (
                <div key={model} className="flex items-center gap-3">
                  <span className="w-36 truncate text-sm">{MODELS.find((m) => m.id === model)?.label ?? model}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand-2"
                      style={{ width: `${(cost / Math.max(...stats.models.map((m) => m[1]), 0.0001)) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-xs text-ink-2">{fmtUsd(cost)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h3 className="mb-4 font-semibold">Top agents by spend</h3>
          <div className="space-y-3">
            {stats.top.map((a) => (
              <div key={a.name} className="flex items-center gap-3">
                <span className="w-32 truncate text-sm">{a.name}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(a.cost / maxAgent) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-xs text-ink-2">{fmtUsd(a.cost)}</span>
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
