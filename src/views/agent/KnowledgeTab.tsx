import clsx from "clsx";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import type { Agent } from "@/types/domain";
import { Button, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { AddDocumentButton, AddMemoryButton } from "@/components/AddKnowledge";
import { relativeTime } from "@/lib/format";
import { ICON_BTN, ListCard, ROW } from "./ListCard";

/** What an agent knows: documents and memory. */
export function KnowledgeTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-6">
      <DocumentsSection agent={agent} />
      <MemorySection agent={agent} />
    </div>
  );
}

function DocumentsSection({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const removeKnowledge = useGaps((s) => s.removeKnowledge);
  return (
    <ListCard
      title="Documents"
      hint="Before each answer, the passages that match the question are handed to the agent."
      action={<AddDocumentButton agentId={agent.id} label="Add" />}
      empty={agent.knowledge.length === 0 && "No documents yet. Add a PDF, notes or an export."}
    >
      {agent.knowledge.map((d) => (
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
              const ok = await confirm({
                title: `Delete "${d.title}"?`,
                body: "The document is removed from this agent's knowledge. This cannot be undone.",
              });
              if (ok) removeKnowledge(agent.id, d.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ListCard>
  );
}

function MemorySection({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const removeNote = useMemory((s) => s.remove);
  const clearAgent = useMemory((s) => s.clearAgent);
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);
  const updateAgent = useGaps((s) => s.updateAgent);
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const mine = notes.filter((n) => n.agentId === agent.id && n.status !== "pending");
  const pending = notes.filter((n) => n.agentId === agent.id && n.status === "pending");

  // "Saves memories itself" IS the Memory skill — one switch, shown here
  // where it matters, not a second setting.
  const skill = agent.skills.find((s) => s.kind === "memory");
  const selfSaving = !!skill?.enabled;
  const setSelfSaving = (on: boolean) => {
    if (skill) toggleSkill(agent.id, skill.id);
    else if (on)
      addSkill(agent.id, { name: "Memory", kind: "memory", description: "Save facts to remember", enabled: true });
  };

  const forgetAll = async () => {
    const ok = await confirm({
      title: `Forget everything ${agent.name} remembers?`,
      body: `All ${mine.length} memories are deleted. This can't be undone.`,
      confirmLabel: "Forget all",
    });
    if (ok) clearAgent(agent.id);
  };

  return (
    <ListCard
      title="Memory"
      hint="Short facts this agent keeps across conversations. The relevant ones are handed to it before every answer."
      action={
        <div className="flex items-center gap-2">
          {mine.length > 0 && (
            <Button variant="ghost" className="hover:text-danger" onClick={forgetAll}>
              Forget all
            </Button>
          )}
          <AddMemoryButton agentId={agent.id} label="Add" />
        </div>
      }
    >
      <li className="space-y-3 px-5 py-3.5">
        <Toggle
          checked={selfSaving}
          onChange={setSelfSaving}
          label="Let the agent save memories itself"
          description="It notes preferences, names and decisions as it works."
        />
        <Toggle
          checked={!!agent.reviewMemory}
          disabled={!selfSaving}
          onChange={(on) => updateAgent(agent.id, { reviewMemory: on })}
          label="Ask me before keeping them"
          description="New facts wait below until you keep or discard them."
        />
      </li>
      {pending.map((n) => (
        <li key={n.id} className={clsx(ROW, "items-start bg-warn/[0.04]")}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-label="Waiting for your OK" />
          <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
            Discard
          </Button>
          <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
            Keep
          </Button>
        </li>
      ))}
      {mine.length === 0 && pending.length === 0 ? (
        <li className="px-5 py-5 text-center text-xs text-ink-3">Nothing remembered yet.</li>
      ) : (
        mine.map((n) => (
          <li key={n.id} className={clsx(ROW, "items-start")}>
            <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
            <span className="num shrink-0 pt-0.5 text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
            <button className={clsx(ICON_BTN, "-my-1")} aria-label="Forget" onClick={() => removeNote(n.id)}>
              <Icon name="x" size={14} />
            </button>
          </li>
        ))
      )}
    </ListCard>
  );
}
