import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { useGaps } from "@/stores/gaps";
import { useBrains } from "@/stores/brains";
import { useRuns } from "@/stores/runs";
import { MODELS, type Agent, type AgentStatus, type Connector, type Skill } from "@/types/domain";
import { Button, Card, Badge, EmptyState, Field, StatusDot, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Chat } from "./agent/Chat";
import { ChannelsTab } from "./agent/ChannelsTab";
import { PromptPlayground } from "./agent/PromptPlayground";
import { httpFetch } from "@/lib/http";
import { useMemory } from "@/stores/memory";
import { fmtTokens, relativeTime, fmtDuration } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

type Tab = "chat" | "playground" | "config" | "skills" | "knowledge" | "memory" | "connections" | "channels" | "logs";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "message" },
  { id: "playground", label: "Playground", icon: "spark" },
  { id: "config", label: "Config", icon: "settings" },
  { id: "skills", label: "Skills", icon: "bolt" },
  { id: "knowledge", label: "Knowledge", icon: "book" },
  { id: "memory", label: "Memory", icon: "book" },
  { id: "connections", label: "Connections", icon: "plug" },
  { id: "channels", label: "Channels", icon: "message" },
  { id: "logs", label: "Logs", icon: "clock" },
];

export function AgentDetailView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const gaps = useGaps((s) => s.gaps);
  const found = useMemo(() => {
    for (const gap of gaps) {
      const agent = gap.agents.find((a) => a.id === id);
      if (agent) return { gap, agent };
    }
    return undefined;
  }, [gaps, id]);
  const updateAgent = useGaps((s) => s.updateAgent);
  const [tab, setTab] = useState<Tab>("chat");

  if (!found) {
    return (
      <div className="p-7">
        <EmptyState icon="agents" title="Agent not found" action={<Button onClick={() => navigate("/agents")}>Back to agents</Button>} />
      </div>
    );
  }
  const { agent, gap } = found;
  const statuses: AgentStatus[] = ["draft", "ready", "live", "paused"];

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border px-7 py-4">
        <button onClick={() => navigate(-1)} className="btn-ghost p-1.5">
          <Icon name="chevron" size={18} className="rotate-180" />
        </button>
        <span className="text-3xl">{agent.emoji}</span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{agent.name}</h1>
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span>{agent.role}</span>·
            <button className="hover:text-ink-2" onClick={() => navigate(`/gaps/${gap.id}`)}>
              {gap.emoji} {gap.name}
            </button>
          </div>
        </div>
        <select
          value={agent.status}
          onChange={(e) => updateAgent(agent.id, { status: e.target.value as AgentStatus })}
          className="input w-auto"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 text-xs text-ink-2">
          <StatusDot status={agent.status} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors",
              tab === t.id ? "border-brand text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {tab === "chat" && <Chat agent={agent} />}
        {tab === "playground" && <PromptPlayground agent={agent} />}
        {tab !== "chat" && tab !== "playground" && (
          <div className="h-full overflow-y-auto p-7">
            {tab === "config" && <ConfigTab agent={agent} />}
            {tab === "skills" && <SkillsTab agent={agent} />}
            {tab === "knowledge" && <KnowledgeTab agent={agent} />}
            {tab === "memory" && <MemoryTab agent={agent} />}
            {tab === "connections" && <ConnectionsTab agent={agent} />}
            {tab === "channels" && <ChannelsTab agent={agent} />}
            {tab === "logs" && <LogsTab agent={agent} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Config -------------------------------- */
function ConfigTab({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const [draft, setDraft] = useState(agent.systemPrompt);
  const dirty = draft !== agent.systemPrompt;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input className="input" value={agent.name} onChange={(e) => updateAgent(agent.id, { name: e.target.value })} />
          </Field>
          <Field label="Role">
            <input className="input" value={agent.role} onChange={(e) => updateAgent(agent.id, { role: e.target.value })} />
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
                updateAgent(agent.id, {
                  runtime: v === "default" ? undefined : (v as Agent["runtime"]),
                });
              }}
            >
              <option value="default">Workspace default</option>
              <option value="api">Claude API (BYOK)</option>
              <option value="claude-code">Claude Code (subscription)</option>
            </select>
          </Field>
        </div>
        <BrainField agent={agent} />
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Temperature · ${agent.temperature.toFixed(1)}`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={agent.temperature}
              onChange={(e) => updateAgent(agent.id, { temperature: Number(e.target.value) })}
              className="w-full accent-brand"
            />
          </Field>
          <Field label="Max tokens">
            <input
              type="number"
              className="input"
              value={agent.maxTokens}
              min={256}
              max={8192}
              step={256}
              onChange={(e) => updateAgent(agent.id, { maxTokens: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">System prompt</h3>
          {dirty && (
            <Button variant="primary" icon="check" onClick={() => updateAgent(agent.id, { systemPrompt: draft })}>
              Save
            </Button>
          )}
        </div>
        <textarea
          className="input min-h-[260px] resize-y font-mono text-[0.82rem] leading-relaxed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="text-xs text-ink-3">Defines the agent's identity and behavior. Retrieved knowledge is appended automatically at chat time.</p>
      </Card>
    </div>
  );
}

/** Attach / detach a Brain — a workspace-level, detachable mind. */
function BrainField({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const brains = useBrains((s) => s.brains);
  const worn = brains.find((b) => b.id === agent.brainId);

  return (
    <Field
      label="Brain"
      hint={
        worn
          ? "Overrides layer on top of this agent's config; detach anytime."
          : "Attach a detachable mind — persona, model preferences, knowledge, memory."
      }
    >
      <div className="flex items-center gap-2">
        <select
          className="input flex-1"
          value={agent.brainId ?? ""}
          onChange={(e) => updateAgent(agent.id, { brainId: e.target.value || undefined })}
        >
          <option value="">None</option>
          {brains.map((b) => (
            <option key={b.id} value={b.id}>
              {b.emoji} {b.name}
            </option>
          ))}
        </select>
        {worn ? (
          <Link to={`/brains/${worn.id}`} className="btn-outline whitespace-nowrap">
            Open brain
          </Link>
        ) : (
          <Link to="/brains" className="btn-outline whitespace-nowrap">
            Manage brains
          </Link>
        )}
      </div>
    </Field>
  );
}

/* ------------------------------- Skills -------------------------------- */
const SKILL_KINDS: { kind: Skill["kind"]; label: string; description: string }[] = [
  { kind: "web_search", label: "Web search", description: "Look things up on the web" },
  { kind: "code", label: "Code", description: "Reason about and generate code" },
  { kind: "files", label: "Files", description: "Read local files" },
  { kind: "http", label: "HTTP", description: "Call external APIs" },
  { kind: "memory", label: "Memory", description: "Remember across conversations" },
  { kind: "custom", label: "Custom", description: "A prompt-defined capability" },
];

function SkillsTab({ agent }: { agent: Agent }) {
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const removeSkill = useGaps((s) => s.removeSkill);
  const owned = new Set(agent.skills.map((s) => s.kind));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h3 className="mb-3 font-semibold">Enabled skills</h3>
        {agent.skills.length === 0 ? (
          <p className="text-sm text-ink-3">No skills yet. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {agent.skills.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-ink-3">{s.description}</div>
                </div>
                <button
                  onClick={() => toggleSkill(agent.id, s.id)}
                  className={clsx("h-6 w-10 rounded-full p-0.5 transition-colors", s.enabled ? "bg-brand" : "bg-surface-2")}
                >
                  <span className={clsx("block h-5 w-5 rounded-full bg-white transition-transform", s.enabled && "translate-x-4")} />
                </button>
                <button className="btn-ghost p-1.5 text-ink-3 hover:text-danger" onClick={() => removeSkill(agent.id, s.id)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Add a skill</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {SKILL_KINDS.map((k) => (
            <button
              key={k.kind}
              disabled={owned.has(k.kind) && k.kind !== "custom"}
              onClick={() => addSkill(agent.id, { name: k.label, kind: k.kind, description: k.description, enabled: true })}
              className="rounded-lg border border-border p-3 text-left transition-colors hover:border-brand/40 disabled:opacity-40"
            >
              <div className="text-sm font-medium">{k.label}</div>
              <div className="text-xs text-ink-3">{k.description}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- Knowledge ------------------------------- */
function KnowledgeTab({ agent }: { agent: Agent }) {
  const addKnowledge = useGaps((s) => s.addKnowledge);
  const removeKnowledge = useGaps((s) => s.removeKnowledge);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const add = () => {
    if (!title.trim() || !content.trim()) return;
    addKnowledge(agent.id, { title: title.trim(), content: content.trim(), bytes: content.length });
    setTitle("");
    setContent("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    addKnowledge(agent.id, { title: file.name, content: text, bytes: text.length, source: "upload" });
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h3 className="mb-3 font-semibold">Knowledge base ({agent.knowledge.length})</h3>
        {agent.knowledge.length === 0 ? (
          <p className="text-sm text-ink-3">No documents. Knowledge is matched against each message and injected into the prompt.</p>
        ) : (
          <div className="space-y-2">
            {agent.knowledge.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
                <Icon name="book" size={16} className="text-ink-3" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.title}</div>
                  <div className="text-xs text-ink-3">{(d.bytes / 1024).toFixed(1)} KB · {relativeTime(d.addedAt)}</div>
                </div>
                <button className="btn-ghost p-1.5 text-ink-3 hover:text-danger" onClick={() => removeKnowledge(agent.id, d.id)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Add knowledge</h3>
          <label className="btn-outline cursor-pointer">
            <Icon name="upload" size={15} /> Upload file
            <input type="file" accept=".txt,.md,.json,.csv" hidden onChange={onFile} />
          </label>
        </div>
        <Field label="Title">
          <input className="input" value={title} placeholder="Product FAQ" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Content">
          <textarea className="input min-h-[140px] resize-y" value={content} placeholder="Paste text…" onChange={(e) => setContent(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" icon="plus" onClick={add} disabled={!title.trim() || !content.trim()}>
            Add document
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------- Connections ------------------------------ */
const CONNECTORS: { provider: Connector["provider"]; label: string; tokenLabel: string; toolHint: string }[] = [
  { provider: "github", label: "GitHub", tokenLabel: "Personal access token", toolHint: "github_api tool" },
  { provider: "slack", label: "Slack", tokenLabel: "Bot token (xoxb-…)", toolHint: "slack_post_message tool" },
  { provider: "notion", label: "Notion", tokenLabel: "Integration token", toolHint: "notion_search tool" },
];

async function validateConnector(provider: Connector["provider"], token: string): Promise<string | null> {
  try {
    if (provider === "github") {
      const r = await httpFetch({
        url: "https://api.github.com/user",
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Forge", Authorization: `Bearer ${token}` },
      });
      return r.ok ? null : `GitHub rejected the token (HTTP ${r.status}).`;
    }
    if (provider === "slack") {
      const r = await httpFetch({
        method: "POST",
        url: "https://slack.com/api/auth.test",
        headers: { Authorization: `Bearer ${token}` },
      });
      const ok = (() => {
        try {
          return JSON.parse(r.body).ok === true;
        } catch {
          return false;
        }
      })();
      return ok ? null : "Slack rejected the token.";
    }
    if (provider === "notion") {
      const r = await httpFetch({
        method: "POST",
        url: "https://api.notion.com/v1/search",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: "{}",
      });
      return r.ok ? null : `Notion rejected the token (HTTP ${r.status}).`;
    }
    return null;
  } catch (e: any) {
    return `Validation failed: ${e?.message ?? e}`;
  }
}

function ConnectionsTab({ agent }: { agent: Agent }) {
  const addConnector = useGaps((s) => s.addConnector);
  const removeConnector = useGaps((s) => s.removeConnector);
  const owned = new Set(agent.connectors.map((c) => c.provider));

  const [active, setActive] = useState<Connector["provider"] | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async (provider: Connector["provider"], label: string) => {
    if (!token.trim()) return;
    setBusy(true);
    setError("");
    const err = await validateConnector(provider, token.trim());
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // Token is stored locally in scopes[0]; tools read it from there.
    addConnector(agent.id, { provider, label, status: "connected", scopes: [token.trim()] });
    setActive(null);
    setToken("");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h3 className="mb-3 font-semibold">Connected services</h3>
        {agent.connectors.length === 0 ? (
          <p className="text-sm text-ink-3">No connectors. Connect a service to give this agent a real tool that calls its API.</p>
        ) : (
          <div className="space-y-2">
            {agent.connectors.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5">
                <Icon name="plug" size={16} className="text-ink-3" />
                <div className="flex-1">
                  <div className="text-sm font-medium capitalize">{c.label}</div>
                  <div className="text-xs text-ink-3">token stored locally · exposes a tool</div>
                </div>
                <Badge tone={c.status === "connected" ? "success" : "neutral"}>{c.status}</Badge>
                <button className="btn-ghost p-1.5 text-ink-3 hover:text-danger" onClick={() => removeConnector(agent.id, c.id)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Connect a service</h3>
        <div className="space-y-2">
          {CONNECTORS.map((c) => {
            const connected = owned.has(c.provider);
            const open = active === c.provider;
            return (
              <div key={c.provider} className="rounded-lg border border-border">
                <button
                  disabled={connected}
                  onClick={() => {
                    setActive(open ? null : c.provider);
                    setToken("");
                    setError("");
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left disabled:opacity-40"
                >
                  <span className="flex-1 text-sm font-medium">{c.label}</span>
                  <span className="text-xs text-ink-3">{c.toolHint}</span>
                  {connected ? <Badge tone="success">connected</Badge> : <Icon name="chevron" size={15} className={open ? "rotate-90" : ""} />}
                </button>
                {open && !connected && (
                  <div className="space-y-2 border-t border-border p-3.5">
                    <input
                      className="input font-mono"
                      type="password"
                      autoFocus
                      placeholder={c.tokenLabel}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    {error && <div className="text-xs text-danger">{error}</div>}
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={() => connect(c.provider, c.label)} disabled={busy || !token.trim()}>
                        {busy ? <Spinner size={14} /> : "Validate & connect"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-3">Tokens are validated against the live API and stored only on this device.</p>
      </Card>
    </div>
  );
}

/* ------------------------------- Memory -------------------------------- */
function MemoryTab({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const remember = useMemory((s) => s.remember);
  const removeNote = useMemory((s) => s.remove);
  const clearAgent = useMemory((s) => s.clearAgent);
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);
  const mine = notes.filter((n) => n.agentId === agent.id && n.status !== "pending");
  const pending = notes.filter((n) => n.agentId === agent.id && n.status === "pending");
  const [text, setText] = useState("");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {pending.length > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">Waiting for review ({pending.length})</h3>
          <p className="mb-3 text-sm text-ink-3">
            The attached brain holds new facts for approval before they stick.
          </p>
          <div className="space-y-2">
            {pending.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-lg border border-warn/40 px-3.5 py-2.5">
                <div className="flex-1 text-sm">{n.text}</div>
                <Button variant="primary" icon="check" onClick={() => approve(n.id)}>
                  Approve
                </Button>
                <Button icon="x" onClick={() => reject(n.id)}>
                  Reject
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Long-term memory ({mine.length})</h3>
          {mine.length > 0 && (
            <Button variant="danger" icon="trash" onClick={async () => {
                if (await confirm({ title: "Clear this agent's memory?", body: `All ${mine.length} saved fact(s) are deleted.`, confirmLabel: "Clear" })) clearAgent(agent.id);
              }}>
              Clear
            </Button>
          )}
        </div>
        <p className="mb-3 text-sm text-ink-3">
          Facts the agent saved with the <code className="font-mono">remember</code> skill, recalled automatically. You can add or remove entries.
        </p>
        {mine.length === 0 ? (
          <p className="text-sm text-ink-3">No memories yet.</p>
        ) : (
          <div className="space-y-2">
            {mine.map((n) => (
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
        )}
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">Add a memory</h3>
        <textarea className="input min-h-[80px] resize-y" placeholder="A fact for this agent to remember…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon="plus"
            disabled={!text.trim()}
            onClick={() => {
              remember(agent.id, text.trim());
              setText("");
            }}
          >
            Save memory
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- Logs --------------------------------- */
function LogsTab({ agent }: { agent: Agent }) {
  const allRuns = useRuns((s) => s.runs);
  const runs = allRuns.filter((r) => r.agentId === agent.id);
  if (runs.length === 0) {
    return <EmptyState icon="clock" title="No runs yet" body="Runs appear here after you chat with this agent." />;
  }
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="p-0">
        <div className="divide-y divide-border">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3">
              <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "paused" : "ready"} />
              <div className="flex-1">
                <div className="text-sm">{r.summary || r.trigger}</div>
                <div className="text-xs text-ink-3">
                  {relativeTime(r.startedAt)} · {r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "running"}
                </div>
              </div>
              <span className="text-xs text-ink-3">{fmtTokens(r.tokensIn + r.tokensOut)} tok</span>
              <Badge tone={r.status === "error" ? "danger" : r.status === "success" ? "success" : "neutral"}>{r.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
