import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, CardHeader, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { useRuns } from "@/stores/runs";
import { useSettings } from "@/stores/settings";
import { useRoutines } from "@/stores/routines";
import { useConversations } from "@/stores/conversations";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { fmtUsd, fmtTokens, relativeTime } from "@/lib/format";
import { MODELS } from "@/types/domain";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Metric({ label, value, sub, to }: { label: string; value: string; sub?: string; to: string }) {
  return (
    <Link to={to} className="card group px-4 py-3.5 transition-colors hover:border-border-strong">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}
    </Link>
  );
}

export function HomeView() {
  const gaps = useGaps((s) => s.gaps);
  const runs = useRuns((s) => s.runs);
  const routines = useRoutines((s) => s.routines);
  const conversations = useConversations((s) => s.conversations);
  const userName = useSettings((s) => s.userName);
  const runtime = useSettings((s) => s.runtime);
  const running = useChannelRuntime((s) => s.running);
  const approvals = useChannelRuntime((s) => s.approvals.length);
  const navigate = useNavigate();

  const agents = useMemo(() => gaps.flatMap((g) => g.agents.map((a) => ({ agent: a, gap: g }))), [gaps]);
  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const dayAgo = Date.now() - 86_400_000;
    const month = runs.filter((r) => r.startedAt >= monthStart.getTime());
    return {
      today: runs.filter((r) => r.startedAt >= dayAgo).length,
      failedToday: runs.filter((r) => r.startedAt >= dayAgo && r.status === "error").length,
      spend: month.reduce((a, r) => a + r.costUsd, 0),
      tokens: month.reduce((a, r) => a + r.tokensIn + r.tokensOut, 0),
    };
  }, [runs]);

  const bots = agents.flatMap(({ agent }) => agent.channels.filter((c) => c.token).map((c) => ({ agent, c })));
  const liveBots = bots.filter(({ agent, c }) => running[channelKey(agent.id, c.id)]);
  const paired = bots.some(({ c }) => (c.owners?.length ?? 0) > 0);
  const lastActive = (agentId: string) =>
    Math.max(0, ...runs.filter((r) => r.agentId === agentId).map((r) => r.startedAt));

  const checklist = [
    { done: true, label: `Runtime ready — ${runtime === "claude-code" ? "Claude Code" : "Claude API"}`, to: "/settings" },
    { done: conversations.some((c) => c.messages.length > 0), label: "Chat with an agent", to: agents[0] ? `/agents/${agents[0].agent.id}` : "/agents" },
    { done: paired, label: "Pair your phone for remote control", to: "/remote" },
    { done: routines.length > 0, label: "Schedule a routine", to: "/schedules" },
  ];
  const showChecklist = checklist.some((c) => !c.done);

  return (
    <div>
      <PageHeader
        title={userName ? `${greeting()}, ${userName}` : greeting()}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
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

      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Agents" value={String(agents.length)} sub={`across ${gaps.length} GAP${gaps.length === 1 ? "" : "s"}`} to="/agents" />
          <Metric label="Reachable by phone" value={String(liveBots.length)} sub={approvals ? `${approvals} waiting for approval` : "live bots"} to="/remote" />
          <Metric
            label="Runs, last 24h"
            value={String(stats.today)}
            sub={stats.failedToday ? `${stats.failedToday} failed` : "no failures"}
            to="/runs"
          />
          <Metric label="Spend this month" value={fmtUsd(stats.spend)} sub={`${fmtTokens(stats.tokens)} tokens`} to="/observability" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="self-start p-0">
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-[13px] font-semibold">Agents</h2>
              <Link to="/agents" className="text-xs text-ink-3 hover:text-ink">
                View all
              </Link>
            </div>
            {agents.length === 0 ? (
              <EmptyState
                icon="agents"
                title="No agents yet"
                body="Install a GAP from the Marketplace, or describe one to the Architect."
                action={
                  <Button variant="primary" icon="spark" onClick={() => navigate("/architect")}>
                    Design with Architect
                  </Button>
                }
              />
            ) : (
              <ul className="mt-2 divide-y divide-border border-t border-border">
                {agents.slice(0, 8).map(({ agent, gap }) => {
                  const last = lastActive(agent.id);
                  const onPhone = agent.channels.some((c) => running[channelKey(agent.id, c.id)]);
                  return (
                    <li key={agent.id}>
                      <Link to={`/agents/${agent.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50">
                        <Avatar emoji={agent.emoji} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{agent.name}</div>
                          <div className="truncate text-xs text-ink-3">
                            {agent.role} · {gap.name}
                          </div>
                        </div>
                        {onPhone && <Icon name="phone" size={13} className="text-success" aria-label="Reachable by phone" />}
                        <span className="hidden w-20 text-right text-[11px] text-ink-3 sm:block">
                          {MODELS.find((m) => m.id === agent.model)?.label}
                        </span>
                        <span className="hidden w-16 text-right text-[11px] text-ink-3 md:block">{last ? relativeTime(last) : "—"}</span>
                        <StatusDot status={agent.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="space-y-6">
            {showChecklist && (
              <Card>
                <CardHeader title="Get set up" hint={`${checklist.filter((c) => c.done).length} of ${checklist.length} done`} />
                <ul className="space-y-1">
                  {checklist.map((c) => (
                    <li key={c.label}>
                      <Link to={c.to} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-surface-2/60">
                        <span
                          className={clsx(
                            "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                            c.done ? "border-success bg-success text-bg" : "border-border-strong",
                          )}
                        >
                          {c.done && <Icon name="check" size={10} strokeWidth={3} />}
                        </span>
                        <span className={c.done ? "text-ink-3 line-through" : "text-ink-2"}>{c.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card className="p-0">
              <div className="flex items-center justify-between px-5 pt-4">
                <h2 className="text-[13px] font-semibold">Recent runs</h2>
                <Link to="/runs" className="text-xs text-ink-3 hover:text-ink">
                  All runs
                </Link>
              </div>
              {runs.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-ink-3">No runs yet. Start a chat with an agent.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border border-t border-border">
                  {runs.slice(0, 7).map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                      <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "error" : r.status === "running" ? "ready" : "draft"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{r.summary || r.agentName}</div>
                        <div className="text-[11px] text-ink-3">
                          {r.agentName} · {r.trigger} · {relativeTime(r.startedAt)}
                        </div>
                      </div>
                      {r.costUsd > 0 && <span className="font-mono text-[11px] text-ink-3">{fmtUsd(r.costUsd)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
