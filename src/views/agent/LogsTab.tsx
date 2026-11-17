import { useRuns } from "@/stores/runs";
import type { Agent, Run } from "@/types/domain";
import { Badge, Card, EmptyState, StatusDot } from "@/components/ui";
import { fmtDuration, fmtTokens, fmtUsd, relativeTime } from "@/lib/format";
import { ListCard, ROW } from "./ListCard";

const DOT: Partial<Record<Run["status"], string>> = { success: "live", error: "error", running: "ready" };

const TONE: Partial<Record<Run["status"], "success" | "danger">> = { success: "success", error: "danger" };

/** What an agent has done. */
export function LogsTab({ agent }: { agent: Agent }) {
  const allRuns = useRuns((s) => s.runs);
  const runs = allRuns.filter((r) => r.agentId === agent.id);
  if (runs.length === 0) {
    return (
      <Card>
        <EmptyState icon="activity" title="No runs yet" body="Runs appear here after you chat with this agent." />
      </Card>
    );
  }
  return (
    <ListCard title="Runs" hint={`${runs.length} for this agent`}>
      {runs.map((r) => (
        <li key={r.id} className={ROW}>
          <StatusDot status={DOT[r.status] ?? "draft"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{r.summary || r.trigger}</div>
            <div className="text-[11px] text-ink-3">
              {r.trigger} · {relativeTime(r.startedAt)} · {r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "running"}
            </div>
          </div>
          <span className="hidden w-16 text-right font-mono text-[11px] text-ink-3 sm:block">
            {fmtTokens(r.tokensIn + r.tokensOut)} tok
          </span>
          <span className="w-14 text-right font-mono text-[11px] text-ink-3">{fmtUsd(r.costUsd)}</span>
          <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
        </li>
      ))}
    </ListCard>
  );
}
