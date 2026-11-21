import { useState } from "react";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { TABS } from "@/components/navTabs";
import { Button, Card, Badge, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useRuns } from "@/stores/runs";
import { useGaps } from "@/stores/gaps";
import { fmtUsd, fmtTokens, relativeTime, fmtDuration } from "@/lib/format";
import { groupRuns, type PackEntry } from "@/lib/runGroups";
import { useDialog } from "@/hooks/useDialog";
import type { Run } from "@/types/domain";

/** "channel" runs came in from a paired phone, so say that. */
const TRIGGER_LABEL: Record<string, string> = { channel: "phone" };
const DOT: Partial<Record<Run["status"], string>> = { success: "live", error: "error", running: "ready" };
const TONE: Partial<Record<Run["status"], "success" | "danger">> = { success: "success", error: "danger" };

const COLS = "grid grid-cols-[auto_minmax(0,1fr)_64px_72px_72px_72px] items-center gap-x-4 px-5";

/**
 * Every run, one row per thing you asked: an agent on its own is a row; a
 * message to a pack is one pack row that opens onto each agent it ran.
 */
export function RunsView() {
  const { confirm } = useDialog();
  const runs = useRuns((s) => s.runs);
  const clear = useRuns((s) => s.clear);
  const entries = groupRuns(runs);

  return (
    <div>
      <PageHeader
        title="Activity"
        tabs={TABS.activity}
        subtitle="Every run, with tokens and cost. Pack chats show as one entry per message."
        actions={
          runs.length > 0 && (
            <Button
              icon="trash"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Clear run history?",
                    body: "Token and cost accounting for past runs is deleted.",
                    confirmLabel: "Clear",
                  })
                )
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
            <EmptyState icon="activity" title="No runs yet" body="Chat with a pack or an agent to generate runs." />
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div
              className={clsx(COLS, "h-9 border-b border-border bg-surface-2/40 text-[11px] font-medium text-ink-3")}
            >
              <span className="w-2" />
              <span>Pack or agent</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-border">
              {entries.map((e) =>
                e.kind === "run" ? (
                  <li key={e.run.id}>
                    <RunRow run={e.run} />
                  </li>
                ) : (
                  <PackRow key={e.id} entry={e} />
                ),
              )}
            </ul>
          </Card>
        )}
      </PageBody>
    </div>
  );
}

function RunRow({ run: r, nested }: { run: Run; nested?: boolean }) {
  return (
    <div className={clsx(COLS, "py-2.5 transition-colors hover:bg-surface-2/50", nested && "bg-surface/40 pl-12")}>
      <StatusDot status={DOT[r.status] ?? "draft"} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{r.agentName}</span>
          {!nested && <span className="chip">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>}
        </div>
        <div className="truncate text-xs text-ink-3">
          {nested ? "" : `${relativeTime(r.startedAt)}${r.summary ? " · " : ""}`}
          {r.summary ?? ""}
        </div>
      </div>
      <span className="text-right text-xs tabular-nums text-ink-2">
        {r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "—"}
      </span>
      <span className="text-right text-xs tabular-nums text-ink-2">{fmtTokens(r.tokensIn + r.tokensOut)}</span>
      <span className="text-right text-xs tabular-nums text-ink-2">{fmtUsd(r.costUsd)}</span>
      <span className="text-right">
        <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
      </span>
    </div>
  );
}

function PackRow({ entry: e }: { entry: PackEntry }) {
  const [open, setOpen] = useState(false);
  const pack = useGaps((s) => s.findGap(e.gapId)?.name) ?? "Removed pack";
  const names = [...new Set(e.runs.map((r) => r.agentName))];
  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={clsx(COLS, "w-full py-2.5 text-left transition-colors hover:bg-surface-2/50")}
      >
        <StatusDot status={DOT[e.status] ?? "draft"} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon
              name="chevron"
              size={12}
              className={clsx("shrink-0 text-ink-3 transition-transform", open && "rotate-90")}
            />
            <span className="truncate text-[13px] font-medium">{pack}</span>
            <span className="chip">pack chat</span>
            <span className="truncate text-xs text-ink-3">{names.join(" → ")}</span>
          </div>
          <div className="truncate pl-5 text-xs text-ink-3">
            {relativeTime(e.startedAt)}
            {e.summary ? ` · ${e.summary}` : ""}
          </div>
        </div>
        <span className="text-right text-xs tabular-nums text-ink-2">
          {e.endedAt ? fmtDuration(e.endedAt - e.startedAt) : "—"}
        </span>
        <span className="text-right text-xs tabular-nums text-ink-2">{fmtTokens(e.tokens)}</span>
        <span className="text-right text-xs tabular-nums text-ink-2">{fmtUsd(e.costUsd)}</span>
        <span className="text-right">
          <Badge tone={TONE[e.status] ?? "neutral"}>{e.status}</Badge>
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {e.runs.map((r) => (
            <li key={r.id}>
              <RunRow run={r} nested />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
