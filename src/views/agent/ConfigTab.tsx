import { useState } from "react";
import { useGaps } from "@/stores/gaps";
import { MODELS, type Agent } from "@/types/domain";
import { Button, Card, CardHeader, Field } from "@/components/ui";
import { supportsSampling } from "@/lib/aiConfig";

const MAX_TOKENS = { min: 256, max: 8192, step: 256 };

export function ConfigTab({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const [draft, setDraft] = useState(agent.systemPrompt);
  const dirty = draft !== agent.systemPrompt;
  const sampling = supportsSampling(agent.model);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Identity & model" hint="Changes save as you type." />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <input
                className="input"
                value={agent.name}
                onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <input
                className="input"
                value={agent.role}
                onChange={(e) => updateAgent(agent.id, { role: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Model">
              <select
                className="input"
                value={agent.model}
                onChange={(e) => updateAgent(agent.id, { model: e.target.value as Agent["model"] })}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Runtime" hint="How this agent executes.">
              <select
                className="input"
                value={agent.runtime ?? "default"}
                onChange={(e) => {
                  const v = e.target.value;
                  updateAgent(agent.id, { runtime: v === "default" ? undefined : (v as Agent["runtime"]) });
                }}
              >
                <option value="default">Workspace default</option>
                <option value="api">Claude API (BYOK)</option>
                <option value="claude-code">Claude Code (subscription)</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {/* Claude 4.7+ reject an explicit temperature, so the control would
                be a lie on most models — say so rather than leave a dead slider. */}
            <Field
              label={`Temperature · ${sampling ? agent.temperature.toFixed(1) : "n/a"}`}
              hint={sampling ? undefined : "This model doesn't accept a temperature setting."}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                disabled={!sampling}
                value={agent.temperature}
                onChange={(e) => updateAgent(agent.id, { temperature: Number(e.target.value) })}
                className="w-full accent-brand disabled:opacity-40"
              />
            </Field>
            <Field label="Max tokens">
              <input
                type="number"
                className="input"
                value={agent.maxTokens}
                {...MAX_TOKENS}
                onChange={(e) => updateAgent(agent.id, { maxTokens: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="System prompt"
          hint="Defines the agent's identity and behavior. Retrieved knowledge is appended automatically at chat time."
          action={
            dirty && (
              <Button variant="primary" icon="check" onClick={() => updateAgent(agent.id, { systemPrompt: draft })}>
                Save
              </Button>
            )
          }
        />
        <textarea
          className="input min-h-[260px] resize-y font-mono text-xs leading-relaxed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </Card>
    </div>
  );
}
