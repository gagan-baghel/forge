import { useState } from "react";
import { Badge, Button, Card, CardHeader, Field } from "@/components/ui";
import { useSettings } from "@/stores/settings";
import { MODELS, type ModelId } from "@/types/domain";

export function ApiSection() {
  const s = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(s.apiKey);
  return (
    <Card>
      <CardHeader
        title="Claude API"
        hint="Optional — only needed for the metered API runtime."
        action={<Badge tone={s.apiKey ? "success" : "neutral"}>{s.apiKey ? "configured" : "not set"}</Badge>}
      />
      <div className="space-y-4">
        <Field
          label="API key"
          hint="Stored on this device only, and stripped out of exported backups. Sent only to Anthropic."
        >
          <div className="flex gap-2">
            <input
              className="input font-mono"
              type={showKey ? "text" : "password"}
              value={keyDraft}
              placeholder="sk-ant-…"
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <Button variant="ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide" : "Show"}
            </Button>
            <Button variant="primary" onClick={() => s.setApiKey(keyDraft.trim())} disabled={keyDraft === s.apiKey}>
              Save
            </Button>
          </div>
        </Field>
        <Field label="Default model">
          <select
            className="input"
            value={s.defaultModel}
            onChange={(e) => s.setDefaultModel(e.target.value as ModelId)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.blurb}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Card>
  );
}
