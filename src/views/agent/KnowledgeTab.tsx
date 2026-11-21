import clsx from "clsx";
import { Link } from "react-router-dom";
import { useGaps } from "@/stores/gaps";
import { useMemory, type MemoryNote } from "@/stores/memory";
import type { Agent, Gap, KnowledgeDoc } from "@/types/domain";
import { Button, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { AddDocumentButton, AddMemoryButton } from "@/components/AddKnowledge";
import { relativeTime } from "@/lib/format";
import { ICON_BTN, ListCard, ROW } from "./ListCard";

/**
 * What an agent knows: its own documents and memory, then what its pack
 * shares with every agent in it (managed on the pack page, shown here so it's
 * clear the agent reads it too).
 */
export function KnowledgeTab({ agent }: { agent: Agent }) {
  const gap = useGaps((s) => s.findGap(agent.gapId));
  return (
    <div className="space-y-6">
      <DocumentsCard
        title="Documents"
        hint={`Only ${agent.name} reads these. Before each answer, the passages that match the question are handed to it.`}
        docs={agent.knowledge}
        add={<AddDocumentButton agentId={agent.id} label="Add" />}
        onRemove={(id) => useGaps.getState().removeKnowledge(agent.id, id)}
        removeBody={`The document is removed from ${agent.name}'s knowledge. This cannot be undone.`}
      />
      <AgentMemory agent={agent} />
      {gap && <SharedFromPack gap={gap} />}
    </div>
  );
}

/** A pack's shared documents and memory, editable: the pack page's Knowledge section. */
export function PackKnowledge({ gap }: { gap: Gap }) {
  return (
    <div className="space-y-6">
      <p className="text-[13px] text-ink-2">
        Shared with every agent in {gap.name}. Each agent also has its own documents and memory, on its Knowledge tab.
      </p>
      <DocumentsCard
        title="Shared documents"
        hint="Every agent in the pack reads these, alongside its own."
        docs={gap.knowledge ?? []}
        add={<AddDocumentButton gapId={gap.id} label="Add" />}
        onRemove={(id) => useGaps.getState().removePackKnowledge(gap.id, id)}
        removeBody="The document is removed from the pack, for every agent in it. This cannot be undone."
      />
      <NotesCard
        title="Shared memory"
        hint="Facts every agent in the pack keeps in mind. Facts agents save during a pack chat land here."
        owner={{ gapId: gap.id }}
        ownerName={gap.name}
        add={<AddMemoryButton gapId={gap.id} label="Add" />}
      />
    </div>
  );
}

export function DocumentsCard({
  title,
  hint,
  docs,
  add,
  onRemove,
  removeBody,
}: {
  title: string;
  hint: string;
  docs: KnowledgeDoc[];
  add: React.ReactNode;
  onRemove: (id: string) => void;
  removeBody: string;
}) {
  const { confirm } = useDialog();
  return (
    <ListCard
      title={title}
      hint={hint}
      action={add}
      empty={docs.length === 0 && "No documents yet. Add a PDF, notes or an export."}
    >
      {docs.map((d) => (
        <li key={d.id} className={ROW}>
          <Icon name="book" size={15} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{d.title}</div>
            <div className="num text-[11px] text-ink-3">
              {(d.bytes / 1024).toFixed(1)} KB · {relativeTime(d.addedAt)}
            </div>
          </div>
          <button
            className={ICON_BTN}
            aria-label={`Delete document ${d.title}`}
            onClick={async () => {
              if (await confirm({ title: `Delete "${d.title}"?`, body: removeBody })) onRemove(d.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ListCard>
  );
}

/** One owner's memories (an agent's or a pack's): waiting ones to approve, then the kept ones. */
function NotesCard({
  title,
  hint,
  owner,
  ownerName,
  add,
  settings,
}: {
  title: string;
  hint: string;
  owner: { agentId: string } | { gapId: string };
  ownerName: string;
  add: React.ReactNode;
  settings?: React.ReactNode;
}) {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const { remove, approve, reject, clearAgent, clearPack } = useMemory.getState();
  const belongs = (n: MemoryNote) =>
    "gapId" in owner ? !n.agentId && n.gapId === owner.gapId : n.agentId === owner.agentId;
  const kept = notes.filter((n) => belongs(n) && n.status !== "pending");
  const pending = notes.filter((n) => belongs(n) && n.status === "pending");

  const forgetAll = async () => {
    const ok = await confirm({
      title: `Forget everything in ${ownerName}'s ${title.toLowerCase()}?`,
      body: `All ${kept.length} memories are deleted. This can't be undone.`,
      confirmLabel: "Forget all",
    });
    if (!ok) return;
    if ("gapId" in owner) clearPack(owner.gapId);
    else clearAgent(owner.agentId);
  };

  return (
    <ListCard
      title={title}
      hint={hint}
      action={
        <div className="flex items-center gap-2">
          {kept.length > 0 && (
            <Button variant="ghost" className="hover:text-danger" onClick={forgetAll}>
              Forget all
            </Button>
          )}
          {add}
        </div>
      }
    >
      {settings}
      {pending.map((n) => (
        <li key={n.id} className={clsx(ROW, "items-start bg-warn/[0.04]")}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-label="Waiting for your OK" />
          <div className="min-w-0 flex-1 text-[13px]">
            {n.text}
            {n.proposedBy && <div className="text-[11px] text-ink-3">Proposed by {n.proposedBy}</div>}
          </div>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
            Discard
          </Button>
          <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
            Keep
          </Button>
        </li>
      ))}
      {kept.length === 0 && pending.length === 0 ? (
        <li className="px-5 py-5 text-center text-xs text-ink-3">Nothing remembered yet.</li>
      ) : (
        kept.map((n) => (
          <li key={n.id} className={clsx(ROW, "items-start")}>
            <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
            <span className="num shrink-0 pt-0.5 text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
            <button className={clsx(ICON_BTN, "-my-1")} aria-label="Forget" onClick={() => remove(n.id)}>
              <Icon name="x" size={14} />
            </button>
          </li>
        ))
      )}
    </ListCard>
  );
}

function AgentMemory({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);

  // "Saves memories itself" IS the Memory skill — one switch, shown here
  // where it matters, not a second setting.
  const skill = agent.skills.find((s) => s.kind === "memory");
  const selfSaving = !!skill?.enabled;
  const setSelfSaving = (on: boolean) => {
    if (skill) toggleSkill(agent.id, skill.id);
    else if (on)
      addSkill(agent.id, { name: "Memory", kind: "memory", description: "Save facts to remember", enabled: true });
  };

  return (
    <NotesCard
      title="Memory"
      hint={`Facts only ${agent.name} keeps across conversations. The relevant ones are handed to it before every answer.`}
      owner={{ agentId: agent.id }}
      ownerName={agent.name}
      add={<AddMemoryButton agentId={agent.id} label="Add" />}
      settings={
        <li className="space-y-3 px-5 py-3.5">
          <Toggle
            checked={selfSaving}
            onChange={setSelfSaving}
            label="Let the agent save memories itself"
            description="In a chat with this agent they go here; in a pack chat they go to the pack's shared memory."
          />
          <Toggle
            checked={!!agent.reviewMemory}
            disabled={!selfSaving}
            onChange={(on) => updateAgent(agent.id, { reviewMemory: on })}
            label="Ask me before keeping them"
            description="New facts wait until you keep or discard them."
          />
        </li>
      }
    />
  );
}

/** Read-only: what the agent also gets from its pack. Edited on the pack page, one home. */
function SharedFromPack({ gap }: { gap: Gap }) {
  // Select the stable list, filter after: a selector returning a fresh array re-renders forever.
  const notes = useMemory((s) => s.notes);
  const shared = notes.filter((n) => !n.agentId && n.gapId === gap.id && n.status !== "pending");
  const docs = gap.knowledge ?? [];
  return (
    <ListCard
      title={`Also shared by ${gap.name}`}
      hint="Every agent in the pack reads these too."
      action={
        <Link to={`/gaps/${gap.id}?section=knowledge`} className="text-xs text-ink-3 hover:text-ink">
          Manage on the pack →
        </Link>
      }
      empty={docs.length === 0 && shared.length === 0 && "The pack shares nothing yet."}
    >
      {docs.map((d) => (
        <li key={d.id} className={ROW}>
          <Icon name="book" size={15} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
          <span className="chip">document</span>
        </li>
      ))}
      {shared.map((n) => (
        <li key={n.id} className={clsx(ROW, "items-start")}>
          <Icon name="memory" size={15} className="mt-0.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 text-[13px]">{n.text}</span>
          <span className="chip">memory</span>
        </li>
      ))}
    </ListCard>
  );
}
