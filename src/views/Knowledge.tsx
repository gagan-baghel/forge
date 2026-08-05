import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Card, Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";

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
      <div className="space-y-6 p-7">
        <div className="flex gap-4">
          <Card className="flex-1">
            <div className="text-2xl font-semibold">{entries.length}</div>
            <div className="text-xs text-ink-3">documents</div>
          </Card>
          <Card className="flex-1">
            <div className="text-2xl font-semibold">{(totalBytes / 1024).toFixed(1)} KB</div>
            <div className="text-xs text-ink-3">total size</div>
          </Card>
          <Card className="flex-1">
            <div className="text-2xl font-semibold">{new Set(entries.map((e) => e.agent.id)).size}</div>
            <div className="text-xs text-ink-3">agents with knowledge</div>
          </Card>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            icon="book"
            title="No knowledge yet"
            body="Open an agent and add documents in its Knowledge tab. Forge matches them against each message — no embeddings server required."
          />
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-border">
              {entries.map(({ doc, agent }) => (
                <Link
                  key={doc.id}
                  to={`/agents/${agent.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <Icon name="book" size={18} className="text-ink-3" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{doc.title}</div>
                    <div className="text-xs text-ink-3">{(doc.bytes / 1024).toFixed(1)} KB · added {relativeTime(doc.addedAt)}</div>
                  </div>
                  <Badge>
                    {agent.emoji} {agent.name}
                  </Badge>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
