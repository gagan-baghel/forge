import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, StatusDot } from "@/components/ui";
import { useRuns } from "@/stores/runs";
import { fmtUsd, fmtTokens, relativeTime, fmtDuration } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

export function RunsView() {
  const { confirm } = useDialog();
  const runs = useRuns((s) => s.runs);
  const clear = useRuns((s) => s.clear);

  return (
    <div>
      <PageHeader
        title="Runs"
        subtitle="Every agent execution with token and cost accounting"
        actions={runs.length > 0 && <Button icon="trash" onClick={async () => {
              if (await confirm({ title: "Clear run history?", body: "Token and cost accounting for past runs is deleted.", confirmLabel: "Clear" })) clear();
            }}>Clear</Button>}
      />
      <div className="p-7">
        {runs.length === 0 ? (
          <EmptyState icon="bolt" title="No runs yet" body="Chat with an agent to generate runs." />
        ) : (
          <Card className="p-0">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-4 px-5 py-2.5 text-xs uppercase tracking-wide text-ink-3 border-b border-border">
              <span></span>
              <span>Agent</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Status</span>
            </div>
            <div className="divide-y divide-border">
              {runs.map((r) => (
                <div key={r.id} className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-4 px-5 py-3">
                  <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "paused" : "ready"} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.agentName}</div>
                    <div className="truncate text-xs text-ink-3">
                      {r.trigger} · {relativeTime(r.startedAt)} {r.summary ? `· ${r.summary}` : ""}
                    </div>
                  </div>
                  <span className="text-right text-xs text-ink-2">{r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "—"}</span>
                  <span className="text-right text-xs text-ink-2">{fmtTokens(r.tokensIn + r.tokensOut)}</span>
                  <span className="text-right text-xs text-ink-2">{fmtUsd(r.costUsd)}</span>
                  <Badge tone={r.status === "error" ? "danger" : r.status === "success" ? "success" : "neutral"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
