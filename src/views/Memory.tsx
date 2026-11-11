import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useMemory, type MemoryNote } from "@/stores/memory";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/components/Confirm";
import { AddMemoryButton } from "@/components/AddKnowledge";

interface Pool {
  key: string;
  title: string;
  subtitle: string;
  /** Where the pool's owner is edited. */
  href: string;
  notes: MemoryNote[];
}

/**
 * Memory — the workspace-wide long-term memory browser (everything the
 * `remember` skill has saved). One section per owner: each agent's private
 * memory. Facts waiting for approval are listed first.
 */
export function MemoryView() {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const removeNote = useMemory((s) => s.remove);
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);
  const clearAgent = useMemory((s) => s.clearAgent);
  const gaps = useGaps((s) => s.gaps);
  const [query, setQuery] = useState("");

  const pools = useMemo<Pool[]>(() => {
    const out: Pool[] = [];
    for (const gap of gaps) {
      for (const agent of gap.agents) {
        out.push({
          key: agent.id,
          title: agent.name,
          subtitle: `${agent.role} · ${gap.name}`,
          href: `/agents/${agent.id}`,
          notes: [],
        });
      }
    }
    const byKey = new Map(out.map((p) => [p.key, p]));
    const q = query.toLowerCase().trim();
    for (const n of notes) {
      if (q && !n.text.toLowerCase().includes(q)) continue;
      const pool = byKey.get(n.agentId);
      if (pool) pool.notes.push(n);
      else {
        // Orphaned owner (agent deleted) — still show so it can be cleaned up.
        const orphan: Pool = {
          key: n.agentId,
          title: "(removed owner)",
          subtitle: n.agentId,
          href: "/memory",
          notes: [n],
        };
        byKey.set(n.agentId, orphan);
        out.push(orphan);
      }
    }
    // Pools with content first, then alphabetical.
    return out.sort((a, b) => b.notes.length - a.notes.length || a.title.localeCompare(b.title));
  }, [notes, gaps, query]);

  const total = notes.length;
  const titleFor = new Map(pools.map((p) => [p.key, p.title]));
  // Waiting-for-approval items come first, on their own: they need a decision.
  const pending = pools.flatMap((p) => p.notes.filter((n) => n.status === "pending"));
  // Only owners that actually remember something; an "Empty." row per agent was noise.
  const visible = pools
    .map((p) => ({ ...p, notes: p.notes.filter((n) => n.status !== "pending") }))
    .filter((p) => p.notes.length > 0);

  return (
    <div>
      <PageHeader
        title="Knowledge"
        tabs={TABS.knowledge}
        subtitle="Facts your agents keep across conversations"
        actions={
          <>
            {total > 0 && <span className="num text-xs text-ink-3">{total} saved</span>}
            <AddMemoryButton />
          </>
        }
      />

      <PageBody className="max-w-3xl space-y-8">
        {total > 0 && (
          <div className="relative">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input h-9 pl-8"
              placeholder="Search memories…"
              aria-label="Search memories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {total === 0 ? (
          <EmptyState
            icon="memory"
            title="Nothing remembered yet"
            body="Write down what an agent should always keep in mind — your preferences, names, decisions. Agents with the Memory skill also save facts themselves as they work. The relevant ones are handed to the agent before every answer."
            action={<AddMemoryButton label="Add your first memory" />}
          />
        ) : (
          <>
            {pending.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-baseline justify-between border-b border-border pb-2 text-[13.5px] font-semibold">
                  Waiting for your OK
                  <span className="num text-[11px] font-normal text-warn">{pending.length}</span>
                </h2>
                <ul className="divide-y divide-border">
                  {pending.map((n) => (
                    <li key={n.id} className="flex items-start gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] text-ink">{n.text}</div>
                        <div className="font-mono text-[10.5px] text-ink-3">
                          {titleFor.get(n.agentId) ?? "removed agent"}
                          {n.proposedBy ? ` · proposed by ${n.proposedBy}` : ""} · {relativeTime(n.createdAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
                          Discard
                        </Button>
                        <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
                          Keep
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {visible.length === 0 && query && <p className="py-6 text-[13px] text-ink-3">No memories match “{query}”.</p>}

            {visible.map((pool) => (
              <section key={pool.key}>
                <div className="mb-1 flex items-center gap-3 border-b border-border pb-2">
                  <Avatar name={pool.title} size={24} />
                  <div className="min-w-0 flex-1">
                    <Link to={pool.href} className="text-[13.5px] font-semibold hover:text-brand-2">
                      {pool.title}
                    </Link>
                    <span className="ml-2 text-xs text-ink-3">{pool.subtitle}</span>
                  </div>
                  <span className="num text-[11px] text-ink-3">{pool.notes.length}</span>
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs hover:text-danger"
                    onClick={async () => {
                      if (await confirm({ title: `Forget everything ${pool.title} remembers?`, body: `All ${pool.notes.length} memories are deleted. This can't be undone.`, confirmLabel: "Forget all" })) clearAgent(pool.key);
                    }}
                  >
                    Forget all
                  </Button>
                </div>
                <ul className="divide-y divide-border">
                  {pool.notes.map((n) => (
                    <li key={n.id} className="group flex items-start gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] text-ink">{n.text}</div>
                        <div className="font-mono text-[10.5px] text-ink-3">{relativeTime(n.createdAt)}</div>
                      </div>
                      <button
                        className="btn-ghost h-6 px-1 text-ink-3 opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label="Forget memory"
                        onClick={() => removeNote(n.id)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </PageBody>
    </div>
  );
}
