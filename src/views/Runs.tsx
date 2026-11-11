import clsx from "clsx";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, StatusDot } from "@/components/ui";
import { useRuns } from "@/stores/runs";
import { fmtUsd, fmtTokens, relativeTime, fmtDuration } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

/** "channel" runs came in from a paired phone, so say that. */
const TRIGGER_LABEL: Record<string, string> = { channel: "phone" };

const COLS = "grid grid-cols-[auto_minmax(0,1fr)_64px_72px_72px_72px] items-center gap-x-4 px-5";

export function RunsView() {
  const { confirm } = useDialog();
  const runs = useRuns((s) => s.runs);
  const clear = useRuns((s) => s.clear);

  return (
    <div>
      <PageHeader
        title="Activity"
        tabs={TABS.activity}
        subtitle="Every agent run, with tokens and cost"
        actions={
          runs.length > 0 && (
            <Button
              icon="trash"
              onClick={async () => {
                if (await confirm({ title: "Clear run history?", body: "Token and cost accounting for past runs is deleted.", confirmLabel: "Clear" }))
                  clear();
              }}
            >
              Clear
            </Button>
          )
        }
      />
      <PageBody>
        {runs.length === 0 ? (
          <Card className="p-0">
            <EmptyState icon="activity" title="No runs yet" body="Chat with an agent to generate runs." />
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className={clsx(COLS, "h-9 border-b border-border bg-surface-2/40 text-[11px] font-medium text-ink-3")}>
              <span className="w-2" />
              <span>Agent</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id} className={clsx(COLS, "py-2.5 transition-colors hover:bg-surface-2/50")}>
                  <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "error" : r.status === "running" ? "ready" : "draft"} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{r.agentName}</span>
                      <span className="chip">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {relativeTime(r.startedAt)}
                      {r.summary ? ` · ${r.summary}` : ""}
                    </div>
                  </div>
                  <span className="text-right text-xs tabular-nums text-ink-2">{r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "—"}</span>
                  <span className="text-right text-xs tabular-nums text-ink-2">{fmtTokens(r.tokensIn + r.tokensOut)}</span>
                  <span className="text-right text-xs tabular-nums text-ink-2">{fmtUsd(r.costUsd)}</span>
                  <span className="text-right">
                    <Badge tone={r.status === "error" ? "danger" : r.status === "success" ? "success" : "neutral"}>{r.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageBody>
    </div>
  );
}
