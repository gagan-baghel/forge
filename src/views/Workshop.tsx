import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, CardHeader, Badge, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { MODELS, type ModelId } from "@/types/domain";

const COLORS = ["#D9703A", "#C49A3C", "#7FA36B", "#6B8FA8", "#A8738F", "#B5654F"];

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
  model: "claude-opus-5-5",
  systemPrompt: "You are a helpful assistant.",
});

/**
 * New pack — the builder walks you from a blank page to a working pack
 * (identity → agents → review), then opens it on its pack page.
 */
export function WorkshopView() {
  return (
    <div>
      <PageHeader back={{ to: "/gaps", label: "Packs" }} title="New pack" subtitle="From a blank page to a working pack in three steps." />
      <PageBody className="max-w-3xl space-y-6">
        <PackBuilder />
      </PageBody>
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
  // Marks are monograms of the name now; the field stays for older packs.
  const emoji = "📦";
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
    navigate(`/gaps/${gap.id}`);
  };

  return (
    <Card className="space-y-5">
      <CardHeader
        title="Pack builder"
        hint="From a blank page to a working pack in three steps."
        action={
          <ol className="flex items-center gap-1">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-1">
                <button
                  onClick={() => i < step && setStep(i as Step)}
                  aria-current={i === step ? "step" : undefined}
                  className={clsx(
                    "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                    i === step ? "bg-surface-2 font-medium text-ink" : i < step ? "text-ink-2 hover:text-ink" : "text-ink-3",
                  )}
                >
                  <span
                    className={clsx(
                      "grid h-4 w-4 place-items-center rounded-full border text-[10px] font-medium",
                      i < step ? "border-success bg-success text-bg" : i === step ? "border-ink-2 text-ink" : "border-border-strong",
                    )}
                  >
                    {i < step ? <Icon name="check" size={9} strokeWidth={3} /> : i + 1}
                  </span>
                  {label}
                </button>
                {i < STEPS.length - 1 && <span className="h-px w-3 bg-border-strong" />}
              </li>
            ))}
          </ol>
        }
      />

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
            <Field label="Color">
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-pressed={color === c}
                    className={clsx(
                      "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface",
                      color === c && "ring-2 ring-ink-2",
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
            <div key={i} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <Avatar name={a.name || `Agent ${i + 1}`} size={22} className="rounded-md" />
                  {a.name.trim() || `Agent ${i + 1}`}
                </span>
                {agents.length > 1 && (
                  <button
                    aria-label={`Remove agent ${i + 1}`}
                    className="btn-ghost h-7 w-7 px-0 text-ink-3 hover:text-danger"
                    onClick={() => setAgents((list) => list.filter((_, j) => j !== i))}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                  className="input min-h-[80px] resize-y font-mono text-xs"
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
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            <Avatar name={name} tint={color} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate text-[13px] font-semibold">{name}</span>
              </div>
              <div className="text-xs text-ink-3">{desc || "No description."}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
            </div>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {validAgents.map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={a.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.name}</div>
                  <div className="truncate text-xs text-ink-3">{a.role || "Assistant"}</div>
                </div>
                <span className="text-[11px] text-ink-3">{MODELS.find((m) => m.id === a.model)?.label}</span>
              </li>
            ))}
          </ul>
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
