import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { MODELS, type ModelId } from "@/types/domain";
import { relativeTime } from "@/lib/format";

const COLORS = ["#6D5BFF", "#40C98E", "#F0B446", "#F46060", "#4FA8FF", "#C46DFF"];
const EMOJIS = ["📦", "🔬", "⚒️", "🎧", "✍️", "📈", "🤖", "🚀", "🧠", "💡"];

interface DraftAgent {
  name: string;
  role: string;
  emoji: string;
  model: ModelId;
  systemPrompt: string;
}

const blankAgent = (): DraftAgent => ({
  name: "",
  role: "",
  emoji: "🤖",
  model: "claude-opus-5",
  systemPrompt: "You are a helpful assistant.",
});

/**
 * Workshop — the pack authoring workspace. The builder walks you from a blank
 * page to a working GAP (identity → agents → review); every installed GAP is
 * listed below with a jump into the full pack editor.
 */
export function WorkshopView() {
  return (
    <div>
      <PageHeader
        title="Workshop"
        subtitle="Author GAPs from scratch and edit every part of the ones you have."
      />
      <div className="mx-auto max-w-3xl space-y-8 p-7">
        <PackBuilder />
        <InstalledPacks />
      </div>
    </div>
  );
}

/* ----------------------------- Pack builder ---------------------------- */
type Step = 0 | 1 | 2;
const STEPS = ["Identity", "Agents", "Review"];

function PackBuilder() {
  const createGap = useGaps((s) => s.createGap);
  const addAgent = useGaps((s) => s.addAgent);
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [tags, setTags] = useState("");
  const [agents, setAgents] = useState<DraftAgent[]>([blankAgent()]);

  const validAgents = agents.filter((a) => a.name.trim());
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? validAgents.length > 0 : true;

  const patchAgent = (i: number, patch: Partial<DraftAgent>) =>
    setAgents((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const build = () => {
    const gap = createGap({
      name: name.trim(),
      description: desc.trim(),
      emoji,
      color,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    for (const a of validAgents) {
      addAgent(gap.id, {
        name: a.name.trim(),
        role: a.role.trim() || "Assistant",
        emoji: a.emoji,
        model: a.model,
        systemPrompt: a.systemPrompt,
      });
    }
    navigate(`/workshop/${gap.id}`);
  };

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Pack builder</h2>
        <div className="flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <button
                onClick={() => i < step && setStep(i as Step)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                  i === step
                    ? "bg-brand/12 font-medium text-ink"
                    : i < step
                      ? "text-ink-2 hover:text-ink"
                      : "text-ink-3",
                )}
              >
                <span
                  className={clsx(
                    "grid h-4 w-4 place-items-center rounded-full text-[0.6rem] font-semibold",
                    i <= step ? "bg-brand text-white" : "bg-surface-2 text-ink-3",
                  )}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 && <Icon name="chevron" size={12} className="text-ink-3" />}
            </div>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <Field label="Pack name">
            <input
              className="input"
              autoFocus
              value={name}
              placeholder="Content Studio"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              className="input min-h-[60px] resize-y"
              value={desc}
              placeholder="What this pack does, in a sentence or two."
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Emoji">
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setEmoji(e)}
                    className={clsx(
                      "grid h-9 w-9 place-items-center rounded-lg border text-lg transition-colors",
                      emoji === e ? "border-brand bg-brand/10" : "border-border hover:border-brand/40",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Color">
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={clsx(
                      "h-8 w-8 rounded-full border-2",
                      color === c ? "border-ink" : "border-transparent",
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
          </div>
          <Field label="Tags" hint="Comma-separated, used for discovery.">
            <input
              className="input"
              value={tags}
              placeholder="content, marketing"
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {agents.map((a, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Agent {i + 1}
                </span>
                {agents.length > 1 && (
                  <button
                    className="btn-ghost p-1.5 text-ink-3 hover:text-danger"
                    onClick={() => setAgents((list) => list.filter((_, j) => j !== i))}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[64px_1fr_1fr] gap-3">
                <Field label="Emoji">
                  <input
                    className="input text-center"
                    value={a.emoji}
                    onChange={(e) => patchAgent(i, { emoji: e.target.value })}
                  />
                </Field>
                <Field label="Name">
                  <input
                    className="input"
                    value={a.name}
                    placeholder="Scout"
                    onChange={(e) => patchAgent(i, { name: e.target.value })}
                  />
                </Field>
                <Field label="Role">
                  <input
                    className="input"
                    value={a.role}
                    placeholder="Research assistant"
                    onChange={(e) => patchAgent(i, { role: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Model">
                  <select
                    className="input"
                    value={a.model}
                    onChange={(e) => patchAgent(i, { model: e.target.value as ModelId })}
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="System prompt">
                <textarea
                  className="input min-h-[80px] resize-y font-mono text-[0.82rem]"
                  value={a.systemPrompt}
                  onChange={(e) => patchAgent(i, { systemPrompt: e.target.value })}
                />
              </Field>
            </div>
          ))}
          <Button icon="plus" onClick={() => setAgents((list) => [...list, blankAgent()])}>
            Add another agent
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border p-4">
            <span className="grid h-12 w-12 place-items-center rounded-xl text-2xl" style={{ background: `${color}22` }}>
              {emoji}
            </span>
            <div className="flex-1">
              <div className="font-semibold">{name}</div>
              <div className="text-sm text-ink-2">{desc || "No description."}</div>
            </div>
            <div className="flex gap-1.5">
              {tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
            </div>
          </div>
          <div className="space-y-2">
            {validAgents.map((a, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
                <span className="text-xl">{a.emoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-ink-3">{a.role || "Assistant"}</div>
                </div>
                <Badge>{MODELS.find((m) => m.id === a.model)?.label}</Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-3">
            The GAP is created locally. You can keep editing it in the pack editor afterwards — and export or publish
            whenever it's ready.
          </p>
        </div>
      )}

      <div className="flex justify-between border-t border-border pt-4">
        <Button disabled={step === 0} onClick={() => setStep((s) => (s - 1) as Step)}>
          Back
        </Button>
        {step < 2 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => (s + 1) as Step)}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" icon="check" onClick={build}>
            Create GAP
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------- Installed packs --------------------------- */
function InstalledPacks() {
  const gaps = useGaps((s) => s.gaps);
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">
        Installed packs <span className="text-sm font-normal text-ink-3">({gaps.length})</span>
      </h2>
      {gaps.length === 0 ? (
        <EmptyState icon="grid" title="Nothing installed" body="Build one above or install from the Marketplace." />
      ) : (
        <div className="space-y-2">
          {gaps.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5">
              <span
                className="grid h-10 w-10 place-items-center rounded-lg text-xl"
                style={{ background: `${g.color}22` }}
              >
                {g.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{g.name}</div>
                <div className="truncate text-xs text-ink-3">
                  v{g.version} · {g.agents.length} agent{g.agents.length === 1 ? "" : "s"} · updated{" "}
                  {relativeTime(g.updatedAt)}
                </div>
              </div>
              <Badge tone="brand">{g.source}</Badge>
              <Button variant="primary" icon="edit" onClick={() => navigate(`/workshop/${g.id}`)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
