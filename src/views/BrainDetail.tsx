import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Button, Card, Badge, EmptyState, Field, StatusDot } from "@/components/ui";
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
      <div className="p-7">
        <EmptyState
          icon="brain"
          title="Brain not found"
          action={<Button onClick={() => navigate("/brains")}>Back to Brains</Button>}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-bg/80 px-7 py-4 backdrop-blur">
        <button onClick={() => navigate("/brains")} className="btn-ghost p-1.5">
          <Icon name="chevron" size={18} className="rotate-180" />
        </button>
        <span className="text-3xl">{brain.emoji}</span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{brain.name}</h1>
          <div className="text-xs text-ink-3">
            v{brain.version} · updated {relativeTime(brain.updatedAt)}
          </div>
        </div>
        {brain.sharedMemory && <Badge tone="success">shared memory</Badge>}
      </div>

      <div className="mx-auto max-w-3xl space-y-6 p-7">
        <IdentityCard brain={brain} />
        <BehaviorCard brain={brain} />
        <MindCard brain={brain} />
        <LearningCard brain={brain} />
        <KnowledgeCard brain={brain} />
        <AttachmentsCard brain={brain} />
        <DangerCard brain={brain} />
      </div>
    </div>
  );
}

/* ------------------------------ Identity ------------------------------- */
function IdentityCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Identity</h3>
      <div className="grid grid-cols-[80px_1fr] gap-4">
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
    </Card>
  );
}

/* ------------------------------ Behavior ------------------------------- */
function BehaviorCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Behavior</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          Optional overrides. Anything left on “agent default” uses the wearing agent's own setting.
        </p>
      </div>
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
              className="btn-ghost whitespace-nowrap px-2 py-1 text-xs text-ink-3"
              onClick={() => updateBrain(brain.id, { temperature: undefined })}
            >
              Reset
            </button>
          )}
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
        <div>
          <div className="text-sm font-medium">Shared memory</div>
          <div className="text-xs text-ink-3">
            All agents wearing this brain remember and recall from one shared pool.
          </div>
        </div>
        <button
          onClick={() => updateBrain(brain.id, { sharedMemory: !brain.sharedMemory })}
          className={clsx(
            "h-6 w-10 rounded-full p-0.5 transition-colors",
            brain.sharedMemory ? "bg-brand" : "bg-surface-2",
          )}
          aria-label="Toggle shared memory"
        >
          <span
            className={clsx(
              "block h-5 w-5 rounded-full bg-white transition-transform",
              brain.sharedMemory && "translate-x-4",
            )}
          />
        </button>
      </div>
      {brain.sharedMemory && <SharedMemoryList brain={brain} />}
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
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n.id} className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-2.5">
          <Icon name="book" size={15} className="mt-0.5 text-ink-3" />
          <div className="flex-1 text-sm">{n.text}</div>
          <span className="text-[0.7rem] text-ink-3">{relativeTime(n.createdAt)}</span>
          <button className="btn-ghost p-1 text-ink-3 hover:text-danger" onClick={() => removeNote(n.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Mind --------------------------------- */
function MindCard({ brain }: { brain: Brain }) {
  const updateBrain = useBrains((s) => s.updateBrain);
  const [draft, setDraft] = useState(brain.systemAppend);
  const dirty = draft !== brain.systemAppend;
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Mind</h3>
        {dirty && (
          <Button variant="primary" icon="check" onClick={() => updateBrain(brain.id, { systemAppend: draft })}>
            Save
          </Button>
        )}
      </div>
      <textarea
        className="input min-h-[160px] resize-y font-mono text-[0.82rem] leading-relaxed"
        value={draft}
        placeholder="Persona, expertise, tone… appended to the system prompt of every agent wearing this brain."
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="text-xs text-ink-3">
        Appended after the agent's own system prompt — the agent keeps its identity, the brain adds its mind.
      </p>
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Learning</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            When on, facts agents try to remember wait here for your approval instead of sticking immediately.
          </p>
        </div>
        <button
          onClick={() => updateBrain(brain.id, { reviewLearning: !brain.reviewLearning })}
          className={clsx(
            "h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors",
            brain.reviewLearning ? "bg-brand" : "bg-surface-2",
          )}
          aria-label="Toggle learning review"
        >
          <span
            className={clsx(
              "block h-5 w-5 rounded-full bg-white transition-transform",
              brain.reviewLearning && "translate-x-4",
            )}
          />
        </button>
      </div>

      {brain.reviewLearning && !brain.sharedMemory && (
        <p className="text-xs text-ink-3">
          Heads up: with shared memory off, each agent's proposals queue on the agent itself — review them in the
          agent's Memory tab or the Memory view. Turn shared memory on to review everything here.
        </p>
      )}

      {key &&
        (pending.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing waiting for review.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-lg border border-warn/40 px-3.5 py-2.5">
                <Icon name="book" size={15} className="mt-0.5 text-warn" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{n.text}</div>
                  <div className="text-[0.7rem] text-ink-3">
                    proposed{n.proposedBy ? ` by ${n.proposedBy}` : ""} · {relativeTime(n.createdAt)}
                  </div>
                </div>
                <Button variant="primary" icon="check" onClick={() => approve(n.id)}>
                  Approve
                </Button>
                <Button icon="x" onClick={() => reject(n.id)}>
                  Reject
                </Button>
              </div>
            ))}
          </div>
        ))}
    </Card>
  );
}

/* ------------------------------ Knowledge ------------------------------ */
function KnowledgeCard({ brain }: { brain: Brain }) {
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
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Knowledge ({brain.knowledge.length})</h3>
        <label className="btn-outline cursor-pointer">
          <Icon name="upload" size={15} /> Upload file
          <input type="file" accept=".txt,.md,.json,.csv" hidden onChange={onFile} />
        </label>
      </div>
      {brain.knowledge.length === 0 ? (
        <p className="text-sm text-ink-3">
          Documents the brain carries with it — retrieved into the prompt for whichever agent wears it.
        </p>
      ) : (
        <div className="space-y-2">
          {brain.knowledge.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
              <Icon name="book" size={16} className="text-ink-3" />
              <div className="flex-1">
                <div className="text-sm font-medium">{d.title}</div>
                <div className="text-xs text-ink-3">
                  {(d.bytes / 1024).toFixed(1)} KB · {relativeTime(d.addedAt)}
                </div>
              </div>
              <button
                className="btn-ghost p-1.5 text-ink-3 hover:text-danger"
                onClick={() => removeKnowledge(brain.id, d.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 border-t border-border pt-4">
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
          <Button variant="primary" icon="plus" onClick={add} disabled={!title.trim() || !content.trim()}>
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
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Attached agents ({wearing.length})</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          Attach this brain to any agent in the workspace. An agent wears one brain at a time; attaching replaces
          whatever it wore before.
        </p>
      </div>
      {agents.length === 0 ? (
        <p className="text-sm text-ink-3">No agents in the workspace yet.</p>
      ) : (
        <div className="space-y-2">
          {agents.map(({ agent, gap }) => {
            const attached = agent.brainId === brain.id;
            const otherBrain = !attached && !!agent.brainId;
            return (
              <div key={agent.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
                <span className="text-xl">{agent.emoji}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/agents/${agent.id}`} className="text-sm font-medium hover:text-brand-2">
                    {agent.name}
                  </Link>
                  <div className="truncate text-xs text-ink-3">
                    {agent.role} · {gap.emoji} {gap.name}
                    {otherBrain && " · wearing another brain"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-2">
                  <StatusDot status={agent.status} />
                </div>
                {attached ? (
                  <Button icon="x" onClick={() => updateAgent(agent.id, { brainId: undefined })}>
                    Detach
                  </Button>
                ) : (
                  <Button variant="primary" icon="plus" onClick={() => updateAgent(agent.id, { brainId: brain.id })}>
                    Attach
                  </Button>
                )}
              </div>
            );
          })}
        </div>
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
    <Card>
      <h3 className="mb-3 font-semibold">Danger zone</h3>
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-2">
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
