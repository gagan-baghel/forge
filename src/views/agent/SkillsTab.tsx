import { useState } from "react";
import clsx from "clsx";
import { useGaps } from "@/stores/gaps";
import type { Agent, Connector, Skill } from "@/types/domain";
import { Badge, Button, Card, CardHeader, Spinner, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { CONNECTORS, connectorToolName, validateConnector, type ConnectorSpec } from "@/lib/tools";
import { ICON_BTN, ListCard, ROW } from "./ListCard";

/** Built-in skills the user can add. Adding one here is all the UI needs. */
const SKILL_KINDS: { kind: Skill["kind"]; label: string; description: string }[] = [
  { kind: "web_search", label: "Web", description: "Search the web and read whole pages" },
  { kind: "code", label: "Code", description: "Run JavaScript and Python — data, charts, files" },
  { kind: "files", label: "Files", description: "Browse folders and read files — asks you first" },
  { kind: "http", label: "HTTP", description: "Call external APIs" },
  { kind: "memory", label: "Memory", description: "Remember across conversations" },
  { kind: "computer", label: "Computer", description: "Run commands and write files — asks you first, every time" },
  { kind: "custom", label: "Custom", description: "A prompt-defined capability" },
];

/** What an agent can do: built-in skills and connected services together. */
export function SkillsTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-6">
      <EnabledSkills agent={agent} />
      <AddSkill agent={agent} />
      <ConnectedServices agent={agent} />
      <ConnectService agent={agent} />
    </div>
  );
}

function EnabledSkills({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const removeSkill = useGaps((s) => s.removeSkill);
  return (
    <ListCard
      title="Enabled skills"
      hint={`${agent.skills.length} installed`}
      empty={agent.skills.length === 0 && "No skills yet. Add one below."}
    >
      {agent.skills.map((s) => (
        <li key={s.id} className={ROW}>
          <div className="min-w-0 flex-1">
            <Toggle
              checked={s.enabled}
              onChange={() => toggleSkill(agent.id, s.id)}
              label={s.name}
              description={s.description}
            />
          </div>
          <button
            className={ICON_BTN}
            aria-label={`Remove skill ${s.name}`}
            onClick={async () => {
              const ok = await confirm({
                title: `Remove "${s.name}"?`,
                body: "The agent loses this ability on its next turn.",
                confirmLabel: "Remove",
              });
              if (ok) removeSkill(agent.id, s.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ListCard>
  );
}

function AddSkill({ agent }: { agent: Agent }) {
  const addSkill = useGaps((s) => s.addSkill);
  const owned = new Set(agent.skills.map((s) => s.kind));
  return (
    <Card>
      <CardHeader title="Add a skill" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {SKILL_KINDS.map((k) => (
          <button
            key={k.kind}
            disabled={owned.has(k.kind) && k.kind !== "custom"}
            onClick={() =>
              addSkill(agent.id, { name: k.label, kind: k.kind, description: k.description, enabled: true })
            }
            className="rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2/50 disabled:opacity-40"
          >
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              <Icon name="plus" size={13} className="text-ink-3" />
              {k.label}
            </div>
            <div className="mt-0.5 text-xs text-ink-3">{k.description}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ConnectedServices({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const removeConnector = useGaps((s) => s.removeConnector);
  return (
    <ListCard
      title="Connected services"
      hint={`${CONNECTORS.map((c) => c.label).join(", ")}. Each one gives this agent a real tool for that service.`}
      empty={agent.connectors.length === 0 && "No connectors yet."}
    >
      {agent.connectors.map((c) => (
        <li key={c.id} className={ROW}>
          <Icon name="plug" size={15} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium capitalize">{c.label}</div>
            <div className="text-[11px] text-ink-3">token stored locally · exposes a tool</div>
          </div>
          <Badge tone={c.status === "connected" ? "success" : "neutral"}>{c.status}</Badge>
          <button
            className={ICON_BTN}
            aria-label={`Disconnect ${c.label}`}
            onClick={async () => {
              const ok = await confirm({
                title: `Disconnect ${c.label}?`,
                body: "Its stored token is deleted and the agent loses the tool.",
                confirmLabel: "Disconnect",
              });
              if (ok) removeConnector(agent.id, c.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ListCard>
  );
}

function ConnectService({ agent }: { agent: Agent }) {
  const owned = new Set(agent.connectors.map((c) => c.provider));
  const [active, setActive] = useState<Connector["provider"] | null>(null);
  return (
    <ListCard
      title="Connect a service"
      hint="Tokens are validated against the live API and stored only on this device."
    >
      {CONNECTORS.map((spec) => (
        <ConnectRow
          key={spec.provider}
          agentId={agent.id}
          spec={spec}
          connected={owned.has(spec.provider)}
          open={active === spec.provider}
          onToggle={() => setActive(active === spec.provider ? null : spec.provider)}
          onDone={() => setActive(null)}
        />
      ))}
    </ListCard>
  );
}

function ConnectRow({
  agentId,
  spec,
  connected,
  open,
  onToggle,
  onDone,
}: {
  agentId: string;
  spec: ConnectorSpec;
  connected: boolean;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const addConnector = useGaps((s) => s.addConnector);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    const err = await validateConnector(spec.provider, value);
    setBusy(false);
    if (err) return setError(err);
    // Token is stored locally in scopes[0]; tools read it from there.
    addConnector(agentId, { provider: spec.provider, label: spec.label, status: "connected", scopes: [value] });
    setToken("");
    onDone();
  };

  return (
    <li>
      <button
        disabled={connected}
        onClick={() => {
          setToken("");
          setError("");
          onToggle();
        }}
        className={clsx(ROW, "w-full text-left disabled:opacity-50")}
      >
        <span className="flex-1 text-[13px] font-medium">{spec.label}</span>
        <span className="font-mono text-[11px] text-ink-3">{connectorToolName(spec)} tool</span>
        {connected ? (
          <Badge tone="success">connected</Badge>
        ) : (
          <Icon name="chevron" size={14} className={clsx("text-ink-3 transition-transform", open && "rotate-90")} />
        )}
      </button>
      {open && !connected && (
        <div className="space-y-2 bg-surface-2/30 px-5 pb-4 pt-1">
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono"
              type="password"
              autoFocus
              placeholder={spec.tokenLabel}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button variant="primary" onClick={connect} disabled={busy || !token.trim()}>
              {busy ? <Spinner size={14} /> : "Validate & connect"}
            </Button>
          </div>
          {error && <div className="text-xs text-danger">{error}</div>}
        </div>
      )}
    </li>
  );
}
