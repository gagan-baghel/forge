import { useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/Shell";
import { TABS } from "@/components/navTabs";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useMemory, type MemoryNote, type MemoryOwner } from "@/stores/memory";
import { useGaps } from "@/stores/gaps";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/hooks/useDialog";
import { AddMemoryButton } from "@/components/AddKnowledge";
import { OwnerBlock } from "./knowledge/OwnerBlock";

/** One owner's memories: a pack's shared pool or one agent's own. */
interface Pool {
  key: string;
  owner: MemoryOwner;
  label: string;
  /** Where the owner is edited. */
  href: string;
  shared: boolean;
  notes: MemoryNote[];
}

interface PackGroup {
  key: string;
  name: string;
  color?: string;
  pools: Pool[];
}

/**
 * Memory — every fact agents keep, by pack: what the pack shares with all its
 * agents, then what each agent keeps to itself. Facts waiting for approval
 * are listed first, since they need a decision.
 */
export function MemoryView() {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const { remove, approve, reject, clearAgent, clearPack } = useMemory.getState();
  const gaps = useGaps((s) => s.gaps);
  const [query, setQuery] = useState("");

  const groups = useMemo<PackGroup[]>(() => {
    const out: PackGroup[] = [];
    const byKey = new Map<string, Pool>();
    for (const gap of gaps) {
      const pools: Pool[] = [
        {
          key: `pack:${gap.id}`,
          owner: { gapId: gap.id },
          label: "Shared with the whole pack",
          href: `/gaps/${gap.id}?section=knowledge`,
          shared: true,
          notes: [],
        },
        ...gap.agents.map((a) => ({
          key: a.id,
          owner: { agentId: a.id },
          label: `${a.name} only`,
          href: `/agents/${a.id}`,
          shared: false,
          notes: [],
        })),
      ];
      pools.forEach((p) => byKey.set(p.key, p));
      out.push({ key: gap.id, name: gap.name, color: gap.color, pools });
    }
    const q = query.toLowerCase().trim();
    for (const n of notes) {
      if (q && !n.text.toLowerCase().includes(q)) continue;
      const key = n.agentId || `pack:${n.gapId}`;
      let pool = byKey.get(key);
      if (!pool) {
        // Orphaned owner (agent or pack deleted) — still shown so it can be cleaned up.
        pool = {
          key,
          owner: n.agentId ? { agentId: n.agentId } : { gapId: n.gapId ?? "" },
          label: "Removed owner",
          href: "/memory",
          shared: !n.agentId,
          notes: [],
        };
        byKey.set(key, pool);
        out.push({ key: `orphan:${key}`, name: "Removed", pools: [pool] });
      }
      pool.notes.push(n);
    }
    return out;
  }, [notes, gaps, query]);

  const total = notes.length;
  const allPools = groups.flatMap((g) => g.pools.map((p) => ({ ...p, pack: g.name })));
  const pending = allPools.flatMap((p) =>
    p.notes.filter((n) => n.status === "pending").map((n) => ({ n, where: `${p.pack} · ${p.label}` })),
  );
  const visible = groups
    .map((g) => ({
      ...g,
      pools: g.pools
        .map((p) => ({ ...p, notes: p.notes.filter((n) => n.status !== "pending") }))
        .filter((p) => p.notes.length > 0),
    }))
    .filter((g) => g.pools.length > 0);

  const forgetAll = async (pool: Pool, pack: string) => {
    const ok = await confirm({
      title: `Forget everything in ${pack} · ${pool.label}?`,
      body: `All ${pool.notes.length} memories are deleted. This can't be undone.`,
      confirmLabel: "Forget all",
    });
    if (!ok) return;
    if ("gapId" in pool.owner) clearPack(pool.owner.gapId);
    else clearAgent(pool.owner.agentId);
  };

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
            body="Write down what to keep in mind — your preferences, names, decisions — for a whole pack (every agent in it sees it) or for one agent. Agents with the Memory skill also save facts themselves: in a pack chat to the pack, in a chat with one agent to that agent."
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
                  {pending.map(({ n, where }) => (
                    <li key={n.id} className="flex items-start gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] text-ink">{n.text}</div>
                        <div className="font-mono text-[10.5px] text-ink-3">
                          {where}
                          {n.proposedBy ? ` · proposed by ${n.proposedBy}` : ""} · {relativeTime(n.createdAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
                          Discard
                        </Button>
                        <Button
                          variant="primary"
                          icon="check"
                          className="h-7 px-2 text-xs"
                          onClick={() => approve(n.id)}
                        >
                          Keep
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {visible.length === 0 && query && (
              <p className="py-6 text-[13px] text-ink-3">No memories match “{query}”.</p>
            )}

            {visible.map((group) => (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-3 border-b border-border pb-2">
                  <Avatar name={group.name} tint={group.color} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{group.name}</span>
                </div>
                <div className="space-y-4">
                  {group.pools.map((pool) => (
                    <OwnerBlock
                      key={pool.key}
                      label={pool.label}
                      href={pool.href}
                      shared={pool.shared}
                      action={
                        <>
                          <span className="num text-[11px] text-ink-3">{pool.notes.length}</span>
                          <button
                            className="text-[11px] text-ink-3 hover:text-danger"
                            onClick={() => forgetAll(pool, group.name)}
                          >
                            Forget all
                          </button>
                        </>
                      }
                    >
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
                              onClick={() => remove(n.id)}
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </OwnerBlock>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </PageBody>
    </div>
  );
}
