import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Field, Badge, Spinner } from "@/components/ui";
import { streamChat } from "@/lib/claude";
import { useSettings } from "@/stores/settings";
import { useGaps } from "@/stores/gaps";
import { buildGap } from "@/lib/seed";
import type { Gap } from "@/types/domain";

const SYSTEM = `You are the Forge Architect. You design "GAPs" (Global Agent Packs) — bundles of AI agents.
Given a user's goal, respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "name": "string",
  "slug": "kebab-case",
  "description": "one sentence",
  "emoji": "single emoji",
  "color": "#hex",
  "tags": ["string"],
  "agents": [
    { "name": "string", "role": "short role", "emoji": "single emoji",
      "systemPrompt": "a strong, specific system prompt written in second person" }
  ]
}
Design 1-3 focused agents. Make system prompts concrete and high quality.`;

interface Draft {
  name: string;
  slug: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
  agents: { name: string; role: string; emoji: string; systemPrompt: string }[];
}

export function ArchitectView() {
  const apiKey = useSettings((s) => s.apiKey);
  const importGap = useGaps((s) => s.importGap);
  const navigate = useNavigate();

  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const design = async () => {
    if (!goal.trim()) return;
    if (!apiKey) {
      setError("Add your Claude API key in Settings first.");
      return;
    }
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      let raw = "";
      await streamChat(
        {
          apiKey,
          model: "claude-opus-4-8",
          system: SYSTEM,
          messages: [{ id: nanoid(6), role: "user", content: goal, createdAt: Date.now() }],
          temperature: 0.7,
          maxTokens: 1500,
        },
        { onText: (d) => (raw += d) },
      );
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      setDraft(JSON.parse(json) as Draft);
    } catch (e: any) {
      setError(`Design failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!draft) return;
    const gap: Gap = buildGap({
      slug: draft.slug,
      name: draft.name,
      description: draft.description,
      emoji: draft.emoji,
      color: draft.color || "#6D5BFF",
      tags: draft.tags ?? [],
      author: "architect",
      agents: draft.agents.map((a) => ({
        name: a.name,
        role: a.role,
        emoji: a.emoji,
        systemPrompt: a.systemPrompt,
      })),
    });
    const installed = importGap(gap);
    navigate(`/gaps/${installed.id}`);
  };

  return (
    <div>
      <PageHeader title="Architect" subtitle="Describe what you want — Claude designs a GAP you can install" />
      <div className="mx-auto max-w-3xl space-y-6 p-7">
        <Card className="space-y-4">
          <Field label="What should this GAP do?">
            <textarea
              className="input min-h-[110px] resize-y"
              placeholder="e.g. A research team that finds academic papers, summarizes them, and drafts a literature review."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-3">Powered by Opus 4.8 · uses your API key</span>
            <Button variant="primary" icon="spark" onClick={design} disabled={busy || !goal.trim()}>
              {busy ? <><Spinner size={15} /> Designing…</> : "Design GAP"}
            </Button>
          </div>
          {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
        </Card>

        {draft && (
          <Card className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl" style={{ background: `${draft.color}22` }}>
                {draft.emoji}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{draft.name}</h3>
                <p className="text-sm text-ink-2">{draft.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(draft.tags ?? []).map((t) => (
                    <Badge key={t}>#{t}</Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {draft.agents.map((a, i) => (
                <div key={i} className="rounded-lg border border-border p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{a.emoji}</span>
                    <span className="text-sm font-medium">{a.name}</span>
                    <Badge>{a.role}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-2">{a.systemPrompt}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDraft(null)}>Discard</Button>
              <Button variant="primary" icon="check" onClick={create}>
                Install this GAP
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
