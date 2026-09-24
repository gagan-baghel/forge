import { Link } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function KnowledgeView() {
  const gaps = useGaps((s) => s.gaps);
  const entries = gaps.flatMap((g) =>
    g.agents.flatMap((a) => a.knowledge.map((d) => ({ doc: d, agent: a, gap: g }))),
  );

  const totalBytes = entries.reduce((a, e) => a + e.doc.bytes, 0);

  return (
    <div>
      <PageHeader
        title="Knowledge"
        subtitle="Every document across your agents — matched and injected at chat time"
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Documents" value={String(entries.length)} />
          <Metric label="Total size" value={`${(totalBytes / 1024).toFixed(1)} KB`} />
          <Metric label="Agents with knowledge" value={String(new Set(entries.map((e) => e.agent.id)).size)} />
        </div>

        <Card className="p-0">
          {entries.length === 0 ? (
            <EmptyState
              icon="book"
              title="No knowledge yet"
              body="Open an agent and add documents in its Knowledge tab. Forge matches them against each message — no embeddings server required."
            />
          ) : (
            <ul className="divide-y divide-border">
              {entries.map(({ doc, agent }) => (
                <li key={doc.id}>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50"
                  >
                    <Icon name="book" size={15} className="shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{doc.title}</div>
                      <div className="text-[11px] tabular-nums text-ink-3">
                        {(doc.bytes / 1024).toFixed(1)} KB · added {relativeTime(doc.addedAt)}
                      </div>
                    </div>
                    <span className="flex min-w-0 items-center gap-2 text-xs text-ink-2">
                      <Avatar emoji={agent.emoji} size={20} className="rounded-md" />
                      <span className="truncate">{agent.name}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
