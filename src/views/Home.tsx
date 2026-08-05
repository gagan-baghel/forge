import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, StatusDot, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { useRuns } from "@/stores/runs";
import { useSettings } from "@/stores/settings";
import { fmtTokens, relativeTime } from "@/lib/format";

function Stat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/12 text-brand-2">
        <Icon name={icon} size={20} />
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-ink-3">{label}</div>
      </div>
    </Card>
  );
}

export function HomeView() {
  const gaps = useGaps((s) => s.gaps);
  const runs = useRuns((s) => s.runs);
  const userName = useSettings((s) => s.userName);
  const navigate = useNavigate();

  const agents = useMemo(() => gaps.flatMap((g) => g.agents), [gaps]);
  const totals = useMemo(() => {
    const tokens = runs.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0);
    return { tokens, runs: runs.length };
  }, [runs]);

  return (
    <div>
      <PageHeader
        title={userName ? `Welcome back, ${userName}` : "Welcome back"}
        subtitle="Your local agent workspace"
        actions={
          <>
            <Button icon="store" onClick={() => navigate("/marketplace")}>
              Marketplace
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("/gaps")}>
              New GAP
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-7">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="GAPs installed" value={String(gaps.length)} icon="grid" />
          <Stat label="Agents" value={String(agents.length)} icon="agents" />
          <Stat label="Total runs" value={String(totals.runs)} icon="bolt" />
          <Stat label="Tokens used" value={fmtTokens(totals.tokens)} icon="chart" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Agent roster */}
          <Card className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Agent roster</h2>
              <Link to="/agents" className="text-xs text-brand-2 hover:underline">
                View all
              </Link>
            </div>
            {agents.length === 0 ? (
              <EmptyState
                icon="agents"
                title="No agents yet"
                body="Install a GAP from the Marketplace or build your own."
                action={
                  <Button variant="primary" icon="store" onClick={() => navigate("/marketplace")}>
                    Browse Marketplace
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {agents.slice(0, 6).map((a) => (
                  <Link
                    key={a.id}
                    to={`/agents/${a.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-2 -mx-2 px-2 rounded-lg"
                  >
                    <span className="text-xl">{a.emoji}</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{a.name}</div>
                      <div className="text-xs text-ink-3">{a.role}</div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-ink-2">
                      <StatusDot status={a.status} />
                      {a.status}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Activity feed */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Recent activity</h2>
              <Link to="/runs" className="text-xs text-brand-2 hover:underline">
                All runs
              </Link>
            </div>
            {runs.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-3">No runs yet. Start a chat with an agent.</p>
            ) : (
              <div className="space-y-3">
                {runs.slice(0, 7).map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "paused" : "ready"} />
                    <div className="flex-1 truncate">
                      <div className="truncate text-sm">{r.agentName}</div>
                      <div className="text-[0.7rem] text-ink-3">{relativeTime(r.startedAt)}</div>
                    </div>
                    <Badge tone={r.status === "error" ? "danger" : "neutral"}>
                      {r.status === "error" ? "error" : `${fmtTokens(r.tokensIn + r.tokensOut)} tok`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
