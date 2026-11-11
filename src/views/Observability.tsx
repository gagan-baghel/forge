import { useMemo } from "react";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Card, CardHeader, EmptyState } from "@/components/ui";
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

  const header = <PageHeader title="Activity" tabs={TABS.activity} subtitle="Spend, volume and reliability over time" />;

  if (runs.length === 0) {
    return (
      <div>
        {header}
        <PageBody>
          <Card className="p-0">
            <EmptyState icon="chart" title="Nothing to chart yet" body="Run some agents and analytics will appear here." />
          </Card>
        </PageBody>
      </div>
    );
  }

  const maxDay = Math.max(...stats.days.map((d) => d.cost), 0.0001);
  const maxAgent = Math.max(...stats.top.map((a) => a.cost), 0.0001);
  const maxFail = Math.max(...stats.failureMix.map((f) => f[1]), 1);
  const maxModel = Math.max(...stats.models.map((m) => m[1]), 0.0001);

  return (
    <div>
      {header}
      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Total spend", fmtUsd(stats.cost)],
            ["Total tokens", fmtTokens(stats.tokens)],
            ["Runs", String(runs.length)],
            ["Error rate", `${stats.errorRate.toFixed(0)}%`],
          ].map(([l, v]) => (
            <div key={l} className="card px-4 py-3.5">
              <div className="text-xs text-ink-3">{l}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <Card>
          <CardHeader title="Spend" hint="Last 14 days" action={<span className="text-xs tabular-nums text-ink-3">max {fmtUsd(maxDay)}</span>} />
          <div className="relative h-40">
            {/* Subtle gridlines at 0 / 50 / 100%. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-5 top-0 flex flex-col justify-between">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border-t border-dashed border-border" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-1.5">
              {stats.days.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <div className="flex w-full flex-1 items-end justify-center">
                    <div
                      className="w-full max-w-[14px] rounded-sm bg-brand/80 transition-colors hover:bg-brand"
                      style={{ height: `${(d.cost / maxDay) * 100}%`, minHeight: d.cost > 0 ? 2 : 0 }}
                      title={`${d.day} · ${fmtUsd(d.cost)}`}
                    />
                  </div>
                  <span className="h-3.5 text-[10px] tabular-nums leading-none text-ink-3">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top agents by spend" />
            <BarList rows={stats.top.map((a) => ({ key: a.name, label: a.name, value: a.cost, text: fmtUsd(a.cost) }))} max={maxAgent} />
          </Card>

          {stats.models.length > 0 && (
            <Card>
              <CardHeader title="Spend by model" />
              <BarList
                rows={stats.models.map(([model, cost]) => ({
                  key: model,
                  label: MODELS.find((m) => m.id === model)?.label ?? model,
                  value: cost,
                  text: fmtUsd(cost),
                }))}
                max={maxModel}
                tone="bg-ink-3"
              />
            </Card>
          )}

          {stats.failureMix.length > 0 && (
            <Card>
              <CardHeader title="Why runs failed" />
              <BarList
                rows={stats.failureMix.map(([kind, n]) => ({
                  key: kind,
                  label: ERROR_LABELS[kind as ErrorKind] ?? kind,
                  value: n,
                  text: String(n),
                }))}
                max={maxFail}
                tone="bg-danger/70"
              />
            </Card>
          )}
        </div>

        <p className="text-xs text-ink-3">
          {gaps.length} GAP{gaps.length === 1 ? "" : "s"} · {gaps.reduce((a, g) => a + g.agents.length, 0)} agents tracked
        </p>
      </PageBody>
    </div>
  );
}

/** Thin horizontal bars: label, track, right-aligned value. */
function BarList({
  rows,
  max,
  tone = "bg-brand/80",
}: {
  rows: { key: string; label: string; value: number; text: string }[];
  max: number;
  tone?: string;
}) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_4rem] items-center gap-3">
          <span className="truncate text-[13px] text-ink-2">{r.label}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="text-right text-xs tabular-nums text-ink-2">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
