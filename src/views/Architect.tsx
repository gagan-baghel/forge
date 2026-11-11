import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, CardHeader, Field, Badge, Spinner } from "@/components/ui";
import { streamChat } from "@/lib/claude";
import { useSettings } from "@/stores/settings";
import { useGaps } from "@/stores/gaps";
import { buildGap } from "@/lib/seed";
import type { Gap } from "@/types/domain";
import { asAgentSeeds, asRecord, asString, asStringArray, extractJsonObject } from "@/lib/validate";

const SYSTEM = `You are the Forge Architect. You design "Packs" (Global Agent Packs) — bundles of AI agents.
Given a user's goal, design 1-3 focused agents. Make each system prompt concrete, specific and
high quality, written in second person. The response shape is enforced by the API, so spend your
effort on the content, not the formatting.`;

/**
 * Enforced response shape. Previously the shape lived in the prompt and the
 * reply was scraped for braces — which failed whenever the model added prose,
 * a code fence, or ran out of tokens mid-object. `parseDraft` stays as the
 * runtime guard: a schema constrains generation, it does not survive a
 * truncated transport.
 */
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    slug: { type: "string" },
    description: { type: "string" },
    emoji: { type: "string" },
    color: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          emoji: { type: "string" },
          systemPrompt: { type: "string" },
        },
        required: ["name", "role", "emoji", "systemPrompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "slug", "description", "emoji", "color", "tags", "agents"],
  additionalProperties: false,
} as const;

interface Draft {
  name: string;
  slug: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
  agents: { name: string; role: string; emoji: string; systemPrompt: string }[];
}

/**
 * Validate the Architect's own output before it can reach `create()`. A model
 * that returns JSON without `agents` used to crash on `draft.agents.map`.
 */
function parseDraft(raw: string): Draft {
  const o = asRecord(extractJsonObject(raw, "design"), "design");
  const name = asString(o.name, "name", { max: 200 });
  return {
    name,
    slug: asString(o.slug, "slug", { max: 120, fallback: "" }) ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    description: asString(o.description, "description", { max: 2000, fallback: "" }),
    emoji: asString(o.emoji, "emoji", { max: 16, fallback: "📦" }),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(o.color ?? "")) ? String(o.color) : "#D9703A",
    tags: asStringArray(o.tags, "tags"),
    agents: asAgentSeeds(o.agents, "agents").map((a) => ({
      name: a.name,
      role: a.role,
      emoji: a.emoji ?? "",
      systemPrompt: a.systemPrompt ?? "",
    })),
  };
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
          model: "claude-opus-5-5",
          system: SYSTEM,
          messages: [{ id: nanoid(6), role: "user", content: goal, createdAt: Date.now() }],
          temperature: 0.7,
          maxTokens: 1500,
          outputConfig: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
        },
        { onText: (d) => (raw += d) },
      );
      setDraft(parseDraft(raw));
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
      color: draft.color || "#D9703A",
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
      <PageHeader back={{ to: "/gaps", label: "Packs" }} title="Architect" subtitle="Describe what you want — Claude designs a pack you can install" />
      <PageBody className="max-w-3xl space-y-6">
        <Card className="space-y-4">
          <Field label="What should this pack do?">
            <textarea
              className="input min-h-[110px] resize-y leading-relaxed"
              placeholder="e.g. A research team that finds academic papers, summarizes them, and drafts a literature review."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-3">Powered by Opus 4.8 · uses your API key</span>
            <Button variant="primary" icon={busy ? undefined : "spark"} onClick={design} disabled={busy || !goal.trim()}>
              {busy ? <><Spinner size={14} /> Designing…</> : "Design pack"}
            </Button>
          </div>
          {error && <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        </Card>

        {draft && (
          <Card className="p-0">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <Avatar name={draft.name} tint={draft.color} size={36} />
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold">{draft.name}</h3>
                <p className="mt-0.5 text-[13px] text-ink-2">{draft.description}</p>
                {(draft.tags ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draft.tags.map((t) => (
                      <Badge key={t}>#{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pt-4">
              <CardHeader title={`Agents (${draft.agents.length})`} />
            </div>
            <ul className="divide-y divide-border border-t border-border">
              {draft.agents.map((a, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={a.name} size={24} className="rounded-md" />
                    <span className="text-[13px] font-medium">{a.name}</span>
                    <Badge>{a.role}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-2">{a.systemPrompt}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button variant="primary" icon="check" onClick={create}>
                Install this GAP
              </Button>
            </div>
          </Card>
        )}
      </PageBody>
    </div>
  );
}
