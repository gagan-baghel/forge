import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useMemory, type MemoryNote } from "@/stores/memory";
import { useGaps } from "@/stores/gaps";
import { useBrains } from "@/stores/brains";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

interface Pool {
  key: string;
  title: string;
  emoji: string;
  subtitle: string;
  /** Where the pool's owner is edited. */
  href: string;
  notes: MemoryNote[];
}

/**
 * Memory — the workspace-wide long-term memory browser (everything the
 * `remember` skill has saved). One section per owner: each agent's private
 * memory and each brain's shared pool. Pending learning-queue items can be
 * approved or rejected inline.
 */
export function MemoryView() {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const removeNote = useMemory((s) => s.remove);
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);
  const clearAgent = useMemory((s) => s.clearAgent);
  const gaps = useGaps((s) => s.gaps);
  const brains = useBrains((s) => s.brains);
  const [query, setQuery] = useState("");

  const pools = useMemo<Pool[]>(() => {
    const out: Pool[] = [];
    for (const brain of brains) {
      if (!brain.sharedMemory) continue;
      out.push({
        key: `brain:${brain.id}`,
        title: brain.name,
        emoji: brain.emoji,
        subtitle: "shared brain pool",
        href: `/brains/${brain.id}`,
        notes: [],
      });
    }
    for (const gap of gaps) {
      for (const agent of gap.agents) {
        out.push({
          key: agent.id,
          title: agent.name,
          emoji: agent.emoji,
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
        // Orphaned owner (agent/brain deleted) — still show so it can be cleaned up.
        const orphan: Pool = {
          key: n.agentId,
          title: "(removed owner)",
          emoji: "🗑",
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
  }, [notes, gaps, brains, query]);

  const total = notes.length;
  const pendingTotal = notes.filter((n) => n.status === "pending").length;
  const bytes = notes.reduce((a, n) => a + n.text.length, 0);

  return (
    <div>
      <PageHeader
        title="Memory"
        subtitle="Everything your agents remember — private per agent, or pooled through a shared brain."
        actions={
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span>{total} memories</span>·<span>{(bytes / 1024).toFixed(1)} KB</span>
            {pendingTotal > 0 && <Badge tone="warn">{pendingTotal} pending review</Badge>}
          </div>
        }
      />

      <div className="mx-auto max-w-3xl space-y-6 p-7">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5">
          <Icon name="search" size={16} className="text-ink-3" />
          <input
            className="w-full bg-transparent py-3 text-sm outline-none"
            placeholder="Search all memories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {total === 0 ? (
          <EmptyState
            icon="book"
            title="No memories yet"
            body="Agents with the Memory skill save facts with `remember` and recall them automatically. Everything they keep shows up here."
          />
        ) : (
          pools
            .filter((p) => p.notes.length > 0 || !query)
            .map((pool) => (
              <Card key={pool.key} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{pool.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <Link to={pool.href} className="text-sm font-semibold hover:text-brand-2">
                      {pool.title}
                    </Link>
                    <div className="truncate text-xs text-ink-3">{pool.subtitle}</div>
                  </div>
                  <Badge tone={pool.key.startsWith("brain:") ? "brand" : "neutral"}>
                    {pool.notes.length} {pool.notes.length === 1 ? "memory" : "memories"}
                  </Badge>
                  {pool.notes.length > 0 && (
                    <Button
                      variant="danger"
                      icon="trash"
                      onClick={async () => {
                        if (await confirm({ title: `Clear ${pool.notes.length} memories?`, body: `Every memory stored for "${pool.title}" is deleted.`, confirmLabel: "Clear" })) clearAgent(pool.key);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {pool.notes.length === 0 ? (
                  <p className="text-sm text-ink-3">Empty.</p>
                ) : (
                  <div className="space-y-2">
                    {pool.notes.map((n) => (
                      <div
                        key={n.id}
                        className={
                          n.status === "pending"
                            ? "flex items-start gap-3 rounded-lg border border-warn/40 px-3.5 py-2.5"
                            : "flex items-start gap-3 rounded-lg border border-border px-3.5 py-2.5"
                        }
                      >
                        <Icon
                          name="book"
                          size={15}
                          className={n.status === "pending" ? "mt-0.5 text-warn" : "mt-0.5 text-ink-3"}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{n.text}</div>
                          <div className="text-[0.7rem] text-ink-3">
                            {n.status === "pending" && `pending${n.proposedBy ? ` · by ${n.proposedBy}` : ""} · `}
                            {relativeTime(n.createdAt)}
                          </div>
                        </div>
                        {n.status === "pending" ? (
                          <>
                            <Button variant="primary" icon="check" onClick={() => approve(n.id)}>
                              Approve
                            </Button>
                            <Button icon="x" onClick={() => reject(n.id)}>
                              Reject
                            </Button>
                          </>
                        ) : (
                          <button
                            className="btn-ghost p-1 text-ink-3 hover:text-danger"
                            onClick={() => removeNote(n.id)}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))
        )}
      </div>
    </div>
  );
}
