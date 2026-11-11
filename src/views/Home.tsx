import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { useRuns } from "@/stores/runs";
import { useSettings } from "@/stores/settings";
import { useRoutines } from "@/stores/routines";
import { useConversations } from "@/stores/conversations";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { fmtUsd, fmtTokens, relativeTime } from "@/lib/format";
import { MODELS } from "@/types/domain";

/** One cell of the status readout: a mono figure over a quiet caption. */
function Readout({ label, value, sub, to, alert }: { label: string; value: string; sub?: string; to: string; alert?: boolean }) {
  return (
    <Link to={to} className="group min-w-0 bg-surface px-5 py-4 transition-colors hover:bg-surface-2">
      <div className="label">{label}</div>
      <div className="num mt-2 text-[26px] leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className={clsx("mt-1.5 truncate text-[12px]", alert ? "text-warn" : "text-ink-3")}>{sub}</div>}
    </Link>
  );
}

/** Section heading with a rule, used down the page instead of boxed card titles. */
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
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
        title={userName ? `${userName}'s workbench` : "Workbench"}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        actions={
          <>
            <Button icon="store" onClick={() => navigate("/marketplace")}>
              Marketplace
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("/workshop")}>
              New pack
            </Button>
          </>
        }
      />

      <PageBody className="space-y-8">
        {/* 1px gaps over the border colour draw the dividers at any column count. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <Readout label="Agents" value={String(agents.length)} sub={`in ${gaps.length} pack${gaps.length === 1 ? "" : "s"}`} to="/agents" />
          <Readout
            label="On your phone"
            value={String(liveBots.length)}
            sub={approvals ? `${approvals} waiting for you` : liveBots.length ? "live now" : "none connected"}
            alert={approvals > 0}
            to="/remote"
          />
          <Readout
            label="Runs · 24h"
            value={String(stats.today)}
            sub={stats.failedToday ? `${stats.failedToday} failed` : "no failures"}
            alert={stats.failedToday > 0}
            to="/runs"
          />
          <Readout label="Spend · month" value={fmtUsd(stats.spend)} sub={`${fmtTokens(stats.tokens)} tokens`} to="/observability" />
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Section
            title="Agents"
            action={
              <Link to="/agents" className="text-xs text-ink-3 hover:text-ink">
                All agents →
              </Link>
            }
          >
            {agents.length === 0 ? (
              <EmptyState
                icon="agents"
                title="No agents yet"
                body="Install a pack from the Marketplace, or describe one to the Architect."
                action={
                  <Button variant="primary" icon="spark" onClick={() => navigate("/architect")}>
                    Design with Architect
                  </Button>
                }
              />
            ) : (
              <table className="w-full table-fixed text-left">
                <thead>
                  <tr className="label">
                    <th className="py-1.5 font-medium">Agent</th>
                    <th className="hidden w-24 py-1.5 font-medium sm:table-cell">Model</th>
                    <th className="hidden w-20 py-1.5 text-right font-medium md:table-cell">Last run</th>
                    <th className="w-16 py-1.5 text-right font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {agents.slice(0, 8).map(({ agent, gap }) => {
                    const last = lastActive(agent.id);
                    const onPhone = agent.channels.some((c) => running[channelKey(agent.id, c.id)]);
                    return (
                      <tr
                        key={agent.id}
                        onClick={() => navigate(`/agents/${agent.id}`)}
                        className="group cursor-pointer transition-colors hover:bg-surface-2/50"
                      >
                        <td className="py-2.5 pr-3">
                          <Link to={`/agents/${agent.id}`} className="flex min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                            <Avatar name={agent.name} tint={gap.color} size={28} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                                <span className="truncate">{agent.name}</span>
                                {onPhone && <Icon name="phone" size={12} className="shrink-0 text-success" aria-label="Reachable by phone" />}
                              </span>
                              <span className="block truncate text-xs text-ink-3">
                                {agent.role} · {gap.name}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="hidden py-2.5 font-mono text-[11.5px] text-ink-2 sm:table-cell">
                          {MODELS.find((m) => m.id === agent.model)?.label ?? "—"}
                        </td>
                        <td className="num hidden py-2.5 text-right text-[11.5px] text-ink-3 md:table-cell">{last ? relativeTime(last) : "—"}</td>
                        <td className="py-2.5 text-right">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                            <StatusDot status={agent.status} />
                            {agent.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          <div className="space-y-8">
            {showChecklist && (
              <Section title="Set up" action={<span className="num text-[11px] text-ink-3">{checklist.filter((c) => c.done).length}/{checklist.length}</span>}>
                <ol>
                  {checklist.map((c, i) => (
                    <li key={c.label}>
                      <Link to={c.to} className="group flex items-baseline gap-3 py-1.5 text-[13px]">
                        <span className={clsx("num w-5 shrink-0 text-[11px]", c.done ? "text-success" : "text-ink-3")}>
                          {c.done ? "✓" : String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={c.done ? "text-ink-3" : "text-ink-2 group-hover:text-ink"}>{c.label}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <Section
              title="Recent runs"
              action={
                <Link to="/runs" className="text-xs text-ink-3 hover:text-ink">
                  All runs →
                </Link>
              }
            >
              {runs.length === 0 ? (
                <p className="py-6 text-[13px] text-ink-3">Nothing has run yet. Open an agent and say hello.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {runs.slice(0, 7).map((r) => (
                    <li key={r.id} className="flex items-start gap-3 py-2">
                      <span className="mt-1.5">
                        <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "error" : r.status === "running" ? "ready" : "draft"} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{r.summary || r.agentName}</div>
                        <div className="font-mono text-[10.5px] text-ink-3">
                          {r.agentName} · {r.trigger} · {relativeTime(r.startedAt)}
                        </div>
                      </div>
                      {r.costUsd > 0 && <span className="num text-[11px] text-ink-3">{fmtUsd(r.costUsd)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
