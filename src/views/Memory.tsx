import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, Badge, EmptyState } from "@/components/ui";
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

  const visible = pools.filter((p) => p.notes.length > 0 || !query);

  return (
    <div>
      <PageHeader
        title="Memory"
        subtitle="Everything your agents remember — private per agent, or pooled through a shared brain."
        actions={
          <div className="flex items-center gap-2 text-xs tabular-nums text-ink-3">
            {pendingTotal > 0 && <Badge tone="warn">{pendingTotal} pending review</Badge>}
            <span>
              {total} memories · {(bytes / 1024).toFixed(1)} KB
            </span>
          </div>
        }
      />

      <PageBody className="max-w-3xl space-y-4">
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            className="input h-9 pl-8"
            placeholder="Search all memories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {total === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon="memory"
              title="No memories yet"
              body="Agents with the Memory skill save facts with `remember` and recall them automatically. Everything they keep shows up here."
            />
          </Card>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-3">No memories match “{query}”.</p>
        ) : (
          visible.map((pool) => (
            <Card key={pool.key} className="p-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <Avatar emoji={pool.emoji} size={28} />
                <div className="min-w-0 flex-1">
                  <Link to={pool.href} className="text-[13px] font-medium hover:text-brand-2">
                    {pool.title}
                  </Link>
                  <div className="truncate text-xs text-ink-3">{pool.subtitle}</div>
                </div>
                <Badge tone={pool.key.startsWith("brain:") ? "brand" : "neutral"}>
                  {pool.notes.length} {pool.notes.length === 1 ? "memory" : "memories"}
                </Badge>
                {pool.notes.length > 0 && (
                  <Button
                    variant="ghost"
                    icon="trash"
                    className="h-7 px-2 text-xs hover:text-danger"
                    onClick={async () => {
                      if (await confirm({ title: `Clear ${pool.notes.length} memories?`, body: `Every memory stored for "${pool.title}" is deleted.`, confirmLabel: "Clear" })) clearAgent(pool.key);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {pool.notes.length === 0 ? (
                <p className="border-t border-border px-4 py-3 text-xs text-ink-3">Empty.</p>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {pool.notes.map((n) => {
                    const pending = n.status === "pending";
                    return (
                      <li
                        key={n.id}
                        className={clsx("group flex items-start gap-3 px-4 py-2.5", pending && "bg-warn/[0.04]")}
                      >
                        <span className={clsx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", pending ? "bg-warn" : "bg-ink-3/50")} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-ink">{n.text}</div>
                          <div className="text-[11px] text-ink-3">
                            {pending && `pending${n.proposedBy ? ` · by ${n.proposedBy}` : ""} · `}
                            {relativeTime(n.createdAt)}
                          </div>
                        </div>
                        {pending ? (
                          <div className="flex shrink-0 gap-1.5">
                            <Button icon="x" variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
                              Reject
                            </Button>
                            <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
                              Approve
                            </Button>
                          </div>
                        ) : (
                          <button
                            className="btn-ghost h-6 px-1 text-ink-3 opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label="Forget memory"
                            onClick={() => removeNote(n.id)}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ))
        )}
      </PageBody>
    </div>
  );
}
