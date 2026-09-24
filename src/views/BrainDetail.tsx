import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageBody } from "@/components/Shell";
import { Avatar, Button, Card, CardHeader, Badge, EmptyState, Field, StatusDot, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useBrains } from "@/stores/brains";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import { MODELS, type Brain, type ModelId } from "@/types/domain";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

/**
 * Brain editor. Everything about one brain is editable here — identity,
 * model overrides, persona, knowledge, memory behavior — plus the attachment
 * surface: wear this brain on any agent in the workspace, detach anytime.
 */
export function BrainDetailView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const brain = useBrains((s) => s.findBrain(id));

  if (!brain) {
    return (
      <PageBody>
        <Card className="p-0">
          <EmptyState
            icon="brain"
            title="Brain not found"
            action={<Button onClick={() => navigate("/brains")}>Back to Brains</Button>}
          />
        </Card>
      </PageBody>
    );
  }

  return (
    <div>
      <div
        className="sticky top-0 z-10 flex min-h-[56px] items-center gap-3 border-b border-border bg-bg/85 px-8 py-3 backdrop-blur"
        data-tauri-drag-region
      >
        <button onClick={() => navigate("/brains")} className="btn-ghost h-7 px-1.5" aria-label="Back to Brains">
          <Icon name="chevron" size={16} className="rotate-180" />
        </button>
        <Avatar emoji={brain.emoji} size={28} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{brain.name}</h1>
          <div className="text-xs text-ink-3">
            v{brain.version} · updated {relativeTime(brain.updatedAt)}
          </div>
        </div>
        {brain.sharedMemory && <Badge tone="success">shared memory</Badge>}
      </div>

      <PageBody className="max-w-3xl space-y-4">
        <IdentityCard brain={brain} />
        <BehaviorCard brain={brain} />
        <MindCard brain={brain} />
        <LearningCard brain={brain} />
        <KnowledgeCard brain={brain} />
        <AttachmentsCard brain={brain} />
        <DangerCard brain={brain} />
      </PageBody>
    </div>
  );
}

/* ------------------------------ Identity ------------------------------- */
function IdentityCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  return (
    <Card>
      <CardHeader title="Identity" />
      <div className="space-y-4">
        <div className="grid grid-cols-[72px_1fr] gap-4">
          <Field label="Emoji">
            <input
              className="input text-center"
              value={brain.emoji}
              onChange={(e) => updateBrain(brain.id, { emoji: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <input
              className="input"
              value={brain.name}
              onChange={(e) => updateBrain(brain.id, { name: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className="input min-h-[60px] resize-y"
            value={brain.description}
            onChange={(e) => updateBrain(brain.id, { description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Version">
            <input
              className="input"
              value={brain.version}
              onChange={(e) => updateBrain(brain.id, { version: e.target.value })}
            />
          </Field>
          <Field label="Tags" hint="Comma-separated.">
            <input
              className="input"
              value={brain.tags.join(", ")}
              onChange={(e) =>
                updateBrain(brain.id, {
                  tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------ Behavior ------------------------------- */
function BehaviorCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  return (
    <Card>
      <CardHeader title="Behavior" hint="Optional overrides. Anything left on “agent default” uses the wearing agent's own setting." />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model">
            <select
              className="input"
              value={brain.model ?? ""}
              onChange={(e) =>
                updateBrain(brain.id, { model: (e.target.value || undefined) as ModelId | undefined })
              }
            >
              <option value="">Agent default</option>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max tokens" hint="Blank = agent default.">
            <input
              type="number"
              className="input"
              value={brain.maxTokens ?? ""}
              min={256}
              max={8192}
              step={256}
              placeholder="agent default"
              onChange={(e) =>
                updateBrain(brain.id, { maxTokens: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <Field
          label={
            brain.temperature === undefined
              ? "Temperature · agent default"
              : `Temperature · ${brain.temperature.toFixed(1)}`
          }
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={brain.temperature ?? 0.7}
              onChange={(e) => updateBrain(brain.id, { temperature: Number(e.target.value) })}
              className="w-full accent-brand"
            />
            {brain.temperature !== undefined && (
              <button
                className="btn-ghost h-7 px-2 text-xs text-ink-3"
                onClick={() => updateBrain(brain.id, { temperature: undefined })}
              >
                Reset
              </button>
            )}
          </div>
        </Field>
        <div className="border-t border-border pt-4">
          <Toggle
            checked={!!brain.sharedMemory}
            onChange={(on) => updateBrain(brain.id, { sharedMemory: on })}
            label="Shared memory"
            description="All agents wearing this brain remember and recall from one shared pool."
          />
        </div>
        {brain.sharedMemory && <SharedMemoryList brain={brain} />}
      </div>
    </Card>
  );
}

function SharedMemoryList({ brain }: { brain: Brain }) {
  const notes = useMemory((s) => s.notes).filter((n) => n.agentId === `brain:${brain.id}`);
  const removeNote = useMemory((s) => s.remove);
  if (notes.length === 0) {
    return <p className="text-xs text-ink-3">The shared pool is empty — agents fill it with the remember skill.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {notes.map((n) => (
        <li key={n.id} className="flex items-start gap-3 px-3 py-2">
          <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
          <span className="shrink-0 text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
          <button className="btn-ghost h-6 px-1 text-ink-3 hover:text-danger" aria-label="Forget memory" onClick={() => removeNote(n.id)}>
            <Icon name="x" size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- Mind --------------------------------- */
function MindCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  const [draft, setDraft] = useState(brain.systemAppend);
  const dirty = draft !== brain.systemAppend;
  return (
    <Card>
      <CardHeader
        title="Mind"
        hint="Appended after the agent's own system prompt — the agent keeps its identity, the brain adds its mind."
        action={
          dirty && (
            <Button variant="primary" icon="check" onClick={() => updateBrain(brain.id, { systemAppend: draft })}>
              Save
            </Button>
          )
        }
      />
      <textarea
        className="input min-h-[160px] resize-y font-mono text-xs leading-relaxed"
        value={draft}
        placeholder="Persona, expertise, tone… appended to the system prompt of every agent wearing this brain."
        onChange={(e) => setDraft(e.target.value)}
      />
    </Card>
  );
}

/* ------------------------------ Learning ------------------------------- */
function LearningCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  const key = brain.sharedMemory ? `brain:${brain.id}` : null;
  const pending = useMemory((s) => s.notes).filter(
    (n) => n.status === "pending" && (key ? n.agentId === key : false),
  );
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);

  return (
    <Card className="space-y-4">
      <Toggle
        checked={!!brain.reviewLearning}
        onChange={(on) => updateBrain(brain.id, { reviewLearning: on })}
        label="Review learning"
        description="When on, facts agents try to remember wait here for your approval instead of sticking immediately."
      />

      {brain.reviewLearning && !brain.sharedMemory && (
        <p className="text-xs text-ink-3">
          Heads up: with shared memory off, each agent's proposals queue on the agent itself — review them in the
          agent's Memory tab or the Memory view. Turn shared memory on to review everything here.
        </p>
      )}

      {key &&
        (pending.length === 0 ? (
          <p className="text-xs text-ink-3">Nothing waiting for review.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pending.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">{n.text}</div>
                  <div className="text-[11px] text-ink-3">
                    proposed{n.proposedBy ? ` by ${n.proposedBy}` : ""} · {relativeTime(n.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="ghost" icon="x" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
                    Reject
                  </Button>
                  <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}

/* ------------------------------ Knowledge ------------------------------ */
function KnowledgeCard({ brain }: { brain: Brain }) {
  const { confirm } = useDialog();
  const addKnowledge = useBrains((s) => s.addKnowledge);
  const removeKnowledge = useBrains((s) => s.removeKnowledge);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const add = () => {
    if (!title.trim() || !content.trim()) return;
    addKnowledge(brain.id, { title: title.trim(), content: content.trim(), bytes: content.length });
    setTitle("");
    setContent("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    addKnowledge(brain.id, { title: file.name, content: text, bytes: text.length, source: "upload" });
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader
        title={`Knowledge (${brain.knowledge.length})`}
        action={
          <label className="btn-outline cursor-pointer">
            <Icon name="upload" size={14} /> Upload file
            <input type="file" accept=".txt,.md,.json,.csv" hidden onChange={onFile} />
          </label>
        }
      />
      {brain.knowledge.length === 0 ? (
        <p className="text-xs text-ink-3">
          Documents the brain carries with it — retrieved into the prompt for whichever agent wears it.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {brain.knowledge.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <Icon name="book" size={14} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{d.title}</div>
                <div className="text-[11px] tabular-nums text-ink-3">
                  {(d.bytes / 1024).toFixed(1)} KB · {relativeTime(d.addedAt)}
                </div>
              </div>
              <button
                className="btn-ghost h-7 px-1.5 text-ink-3 hover:text-danger"
                aria-label={`Delete document ${d.title}`}
                onClick={async () => {
                  if (await confirm({ title: `Delete "${d.title}"?`, body: "Every agent wearing this brain loses the document. This cannot be undone." }))
                    removeKnowledge(brain.id, d.id);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3 border-t border-border pt-4">
        <Field label="Title">
          <input className="input" value={title} placeholder="Style guide" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Content">
          <textarea
            className="input min-h-[100px] resize-y"
            value={content}
            placeholder="Paste text…"
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button icon="plus" onClick={add} disabled={!title.trim() || !content.trim()}>
            Add document
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- Attachments ----------------------------- */
function AttachmentsCard({ brain }: { brain: Brain }) {
  const gaps = useGaps((s) => s.gaps);
  const updateAgent = useGaps((s) => s.updateAgent);
  const agents = gaps.flatMap((g) => g.agents.map((a) => ({ agent: a, gap: g })));
  const wearing = agents.filter(({ agent }) => agent.brainId === brain.id);

  return (
    <Card>
      <CardHeader
        title={`Attached agents (${wearing.length})`}
        hint="Attach this brain to any agent in the workspace. An agent wears one brain at a time; attaching replaces whatever it wore before."
      />
      {agents.length === 0 ? (
        <p className="text-xs text-ink-3">No agents in the workspace yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {agents.map(({ agent, gap }) => {
            const attached = agent.brainId === brain.id;
            const otherBrain = !attached && !!agent.brainId;
            return (
              <li key={agent.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar emoji={agent.emoji} size={26} />
                <div className="min-w-0 flex-1">
                  <Link to={`/agents/${agent.id}`} className="text-[13px] font-medium hover:text-brand-2">
                    {agent.name}
                  </Link>
                  <div className="truncate text-xs text-ink-3">
                    {agent.role} · {gap.name}
                    {otherBrain && " · wearing another brain"}
                  </div>
                </div>
                <StatusDot status={agent.status} />
                {attached ? (
                  <Button variant="ghost" icon="x" className="h-7 px-2 text-xs" onClick={() => updateAgent(agent.id, { brainId: undefined })}>
                    Detach
                  </Button>
                ) : (
                  <Button icon="plus" className="h-7 px-2 text-xs" onClick={() => updateAgent(agent.id, { brainId: brain.id })}>
                    Attach
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------- Danger -------------------------------- */
function DangerCard({ brain }: { brain: Brain }) {
  const { confirm } = useDialog();
  const deleteBrain = useBrains((s) => s.deleteBrain);
  const navigate = useNavigate();
  return (
    <Card className="border-danger/25">
      <CardHeader title="Danger zone" />
      <div className="flex items-center justify-between gap-4">
        <div className="text-[13px] text-ink-2">
          Delete this brain. It's detached from every agent first; agents keep their own config.
        </div>
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            if (await confirm({ title: `Delete brain "${brain.name}"?`, body: "Its persona, knowledge and shared memory are deleted. Agents wearing it revert to their own settings." })) {
              deleteBrain(brain.id);
              navigate("/brains");
            }
          }}
        >
          Delete brain
        </Button>
      </div>
    </Card>
  );
}
