import { Link } from "react-router-dom";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Avatar, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AddDocumentButton } from "@/components/AddKnowledge";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Every document any agent can read, grouped by the agent that reads it.
 * Documents are added and removed on the agent itself (its Knowledge tab);
 * this page is the one place to see them all.
 */
export function KnowledgeView() {
  const gaps = useGaps((s) => s.gaps);
  const groups = gaps.flatMap((g) => g.agents.filter((a) => a.knowledge.length > 0).map((agent) => ({ agent, gap: g })));
  const count = groups.reduce((n, { agent }) => n + agent.knowledge.length, 0);

  return (
    <div>
      <PageHeader
        title="Knowledge"
        tabs={TABS.knowledge}
        subtitle="Documents your agents read before answering"
        actions={
          <>
            {count > 0 && <span className="num text-xs text-ink-3">{count} document{count === 1 ? "" : "s"}</span>}
            <AddDocumentButton />
          </>
        }
      />
      <PageBody className="max-w-3xl space-y-8">
        {groups.length === 0 ? (
          <EmptyState
            icon="book"
            title="No documents yet"
            body="Add PDFs, notes or exports to an agent. Before each answer, Forge finds the passages that match the question and hands them to the agent. Files are read on this computer and never uploaded."
            action={<AddDocumentButton label="Add your first document" />}
          />
        ) : (
          groups.map(({ agent, gap }) => (
            <section key={agent.id}>
              <div className="mb-1 flex items-center gap-3 border-b border-border pb-2">
                <Avatar name={agent.name} tint={gap.color} size={24} />
                <Link to={`/agents/${agent.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:text-brand-2">
                  {agent.name}
                  <span className="ml-2 text-xs font-normal text-ink-3">{gap.name}</span>
                </Link>
                <Link to={`/agents/${agent.id}`} className="text-xs text-ink-3 hover:text-ink">
                  Manage →
                </Link>
              </div>
              <ul className="divide-y divide-border">
                {agent.knowledge.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 py-2">
                    <Icon name="book" size={14} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{doc.title}</span>
                    <span className="num shrink-0 text-[11px] text-ink-3">
                      {kb(doc.bytes)} · {relativeTime(doc.addedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </PageBody>
    </div>
  );
}
