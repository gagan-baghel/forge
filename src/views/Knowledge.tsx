import { PageBody, PageHeader } from "@/components/Shell";
import { TABS } from "@/components/navTabs";
import { Avatar, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AddDocumentButton } from "@/components/AddKnowledge";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";
import type { KnowledgeDoc } from "@/types/domain";
import { OwnerBlock } from "./knowledge/OwnerBlock";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Every document any agent can read, by pack: what the pack shares with all
 * its agents, then what each agent reads on its own. Added and removed where
 * they live (the pack's or the agent's Knowledge); this page shows them all.
 */
export function KnowledgeView() {
  const gaps = useGaps((s) => s.gaps);
  const packs = gaps
    .map((gap) => ({
      gap,
      shared: gap.knowledge ?? [],
      agents: gap.agents.filter((a) => a.knowledge.length > 0),
    }))
    .filter((p) => p.shared.length > 0 || p.agents.length > 0);
  const count = packs.reduce((n, p) => n + p.shared.length + p.agents.reduce((m, a) => m + a.knowledge.length, 0), 0);

  return (
    <div>
      <PageHeader
        title="Knowledge"
        tabs={TABS.knowledge}
        subtitle="Documents your agents read before answering"
        actions={
          <>
            {count > 0 && (
              <span className="num text-xs text-ink-3">
                {count} document{count === 1 ? "" : "s"}
              </span>
            )}
            <AddDocumentButton />
          </>
        }
      />
      <PageBody className="max-w-3xl space-y-8">
        {packs.length === 0 ? (
          <EmptyState
            icon="book"
            title="No documents yet"
            body="Add PDFs, notes or exports to a whole pack (every agent in it reads them) or to one agent. Before each answer, Forge finds the passages that match the question and hands them to the agent. Files are read on this computer and never uploaded."
            action={<AddDocumentButton label="Add your first document" />}
          />
        ) : (
          packs.map(({ gap, shared, agents }) => (
            <section key={gap.id}>
              <div className="mb-2 flex items-center gap-3 border-b border-border pb-2">
                <Avatar name={gap.name} tint={gap.color} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{gap.name}</span>
              </div>
              <div className="space-y-4">
                {shared.length > 0 && (
                  <OwnerBlock shared label="Shared with the whole pack" href={`/gaps/${gap.id}?section=knowledge`}>
                    <DocRows docs={shared} />
                  </OwnerBlock>
                )}
                {agents.map((agent) => (
                  <OwnerBlock key={agent.id} label={`${agent.name} only`} href={`/agents/${agent.id}`}>
                    <DocRows docs={agent.knowledge} />
                  </OwnerBlock>
                ))}
              </div>
            </section>
          ))
        )}
      </PageBody>
    </div>
  );
}

function DocRows({ docs }: { docs: KnowledgeDoc[] }) {
  return (
    <ul className="divide-y divide-border">
      {docs.map((doc) => (
        <li key={doc.id} className="flex items-center gap-3 py-2">
          <Icon name="book" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[13.5px]">{doc.title}</span>
          <span className="num shrink-0 text-[11px] text-ink-3">
            {kb(doc.bytes)} · {relativeTime(doc.addedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
