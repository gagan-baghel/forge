import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { useGaps } from "@/stores/gaps";
import { useRuns } from "@/stores/runs";
import { MODELS, type Agent, type AgentStatus, type Connector, type Skill } from "@/types/domain";
import { Avatar, Button, Card, CardHeader, Badge, EmptyState, Field, StatusDot, Spinner, Tabs, Toggle } from "@/components/ui";
import { PageBody } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { Chat } from "./agent/Chat";
import { ChannelsTab } from "./agent/ChannelsTab";
import { httpFetch } from "@/lib/http";
import { useMemory } from "@/stores/memory";
import { AddDocumentButton, AddMemoryButton } from "@/components/AddKnowledge";
import { fmtUsd, fmtTokens, relativeTime, fmtDuration } from "@/lib/format";
import { useDialog } from "@/components/Confirm";
import { supportsSampling } from "@/lib/aiConfig";

/**
 * One tab per question: talk to it, how it's set up, what it can do, what it
 * knows (documents + memory, same split as the Knowledge page), what it's
 * connected to, where it can be reached, and what it has done.
 */
type Tab = "chat" | "config" | "skills" | "knowledge" | "connections" | "channels" | "logs";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "message" },
  { id: "config", label: "Setup", icon: "settings" },
  { id: "skills", label: "Skills", icon: "bolt" },
  { id: "knowledge", label: "Knowledge", icon: "book" },
  { id: "connections", label: "Connections", icon: "plug" },
  { id: "channels", label: "Remote", icon: "phone" },
  { id: "logs", label: "Activity", icon: "activity" },
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
      <PageBody>
        <EmptyState icon="agents" title="Agent not found" action={<Button onClick={() => navigate("/agents")}>Back to agents</Button>} />
      </PageBody>
    );
  }
  const { agent, gap } = found;
  const statuses: AgentStatus[] = ["draft", "ready", "live", "paused"];
  const bots = agent.channels.filter((c) => (c.kind === "telegram" || c.kind === "discord") && c.token).length;
  const tabs = TABS.map((t) =>
    t.id === "channels" ? { ...t, count: bots } : t.id === "skills" ? { ...t, count: agent.skills.length } : t,
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-bg/85 px-6 backdrop-blur" data-tauri-drag-region>
        <div className="flex min-h-[56px] items-center gap-3 py-3">
          <Link to="/agents" className="btn-ghost h-7 w-7 px-0" aria-label="Back to agents" title="Agents">
            <Icon name="chevron" size={16} className="rotate-180" />
          </Link>
          <Avatar name={agent.name} size={32} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{agent.name}</h1>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
              <span className="truncate">{agent.role}</span>
              <span>·</span>
              <Link to={`/gaps/${gap.id}`} className="truncate hover:text-ink">
                {gap.name}
              </Link>
            </div>
          </div>
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface pl-2.5 pr-1 hover:border-border-strong">
            <StatusDot status={agent.status} pulse={agent.status === "live"} />
            <select
              aria-label="Status"
              value={agent.status}
              onChange={(e) => updateAgent(agent.id, { status: e.target.value as AgentStatus })}
              className="h-full cursor-pointer bg-transparent pr-1 text-[13px] capitalize text-ink outline-none"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="-mb-px" />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "chat" && <Chat agent={agent} />}
        {tab !== "chat" && (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-8 py-6">
              {tab === "config" && <ConfigTab agent={agent} />}
              {tab === "skills" && <SkillsTab agent={agent} />}
              {tab === "knowledge" && <KnowledgeTab agent={agent} />}
              {tab === "connections" && <ConnectionsTab agent={agent} />}
              {tab === "channels" && <ChannelsTab agent={agent} />}
              {tab === "logs" && <LogsTab agent={agent} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A card holding an edge-to-edge list, with a header and an empty line. */
function ListCard({
  title,
  hint,
  action,
  empty,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-0">
      <div className="px-5 pt-4">
        <CardHeader title={title} hint={hint} action={action} />
      </div>
      {empty ? (
        <p className="border-t border-border px-5 py-6 text-center text-xs text-ink-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">{children}</ul>
      )}
    </Card>
  );
}

const ROW = "flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50";
const ICON_BTN = "btn-ghost h-7 w-7 shrink-0 px-0 text-ink-3 hover:text-danger";

/* ------------------------------- Config -------------------------------- */
function ConfigTab({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const [draft, setDraft] = useState(agent.systemPrompt);
  const dirty = draft !== agent.systemPrompt;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Identity & model" hint="Changes save as you type." />
        <div className="space-y-4">
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
          <div className="grid grid-cols-2 gap-4">
            {/* Claude 4.7+ reject an explicit temperature, so the control would
                be a lie on most models — say so rather than leave a dead slider. */}
            <Field
              label={`Temperature · ${supportsSampling(agent.model) ? agent.temperature.toFixed(1) : "n/a"}`}
              hint={supportsSampling(agent.model) ? undefined : "This model doesn't accept a temperature setting."}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                disabled={!supportsSampling(agent.model)}
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
                min={256}
                max={8192}
                step={256}
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

/* ------------------------------- Skills -------------------------------- */
const SKILL_KINDS: { kind: Skill["kind"]; label: string; description: string }[] = [
  { kind: "web_search", label: "Web", description: "Search the web and read whole pages" },
  { kind: "code", label: "Code", description: "Run JavaScript and Python — data, charts, files" },
  { kind: "files", label: "Files", description: "Browse folders and read files — asks you first" },
  { kind: "http", label: "HTTP", description: "Call external APIs" },
  { kind: "memory", label: "Memory", description: "Remember across conversations" },
  { kind: "computer", label: "Computer", description: "Run commands and write files — asks you first, every time" },
  { kind: "custom", label: "Custom", description: "A prompt-defined capability" },
];

function SkillsTab({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const removeSkill = useGaps((s) => s.removeSkill);
  const owned = new Set(agent.skills.map((s) => s.kind));

  return (
    <div className="space-y-6">
      <ListCard title="Enabled skills" hint={`${agent.skills.length} installed`} empty={agent.skills.length === 0 && "No skills yet. Add one below."}>
        {agent.skills.map((s) => (
          <li key={s.id} className={ROW}>
            <div className="min-w-0 flex-1">
              <Toggle checked={s.enabled} onChange={() => toggleSkill(agent.id, s.id)} label={s.name} description={s.description} />
            </div>
            <button
              className={ICON_BTN}
              aria-label={`Remove skill ${s.name}`}
              onClick={async () => {
                if (await confirm({ title: `Remove "${s.name}"?`, body: "The agent loses this ability on its next turn.", confirmLabel: "Remove" }))
                  removeSkill(agent.id, s.id);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ListCard>

      <Card>
        <CardHeader title="Add a skill" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {SKILL_KINDS.map((k) => (
            <button
              key={k.kind}
              disabled={owned.has(k.kind) && k.kind !== "custom"}
              onClick={() => addSkill(agent.id, { name: k.label, kind: k.kind, description: k.description, enabled: true })}
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
    </div>
  );
}

/* ----------------------------- Knowledge ------------------------------- */
function KnowledgeTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-6">
      <DocumentsSection agent={agent} />
      <MemorySection agent={agent} />
    </div>
  );
}

function DocumentsSection({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const removeKnowledge = useGaps((s) => s.removeKnowledge);
  return (
    <ListCard
      title="Documents"
      hint="Before each answer, the passages that match the question are handed to the agent."
      action={<AddDocumentButton agentId={agent.id} label="Add" />}
      empty={agent.knowledge.length === 0 && "No documents yet. Add a PDF, notes or an export."}
    >
      {agent.knowledge.map((d) => (
        <li key={d.id} className={ROW}>
          <Icon name="book" size={15} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{d.title}</div>
            <div className="num text-[11px] text-ink-3">
              {(d.bytes / 1024).toFixed(1)} KB · {relativeTime(d.addedAt)}
            </div>
          </div>
          <button
            className={ICON_BTN}
            aria-label={`Delete document ${d.title}`}
            onClick={async () => {
              if (await confirm({ title: `Delete "${d.title}"?`, body: "The document is removed from this agent's knowledge. This cannot be undone." }))
                removeKnowledge(agent.id, d.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </li>
      ))}
    </ListCard>
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
  const { confirm } = useDialog();
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
    <div className="space-y-6">
      <ListCard
        title="Connected services"
        hint="Each connection gives this agent a real tool that calls the service's API."
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
                if (await confirm({ title: `Disconnect ${c.label}?`, body: "Its stored token is deleted and the agent loses the tool.", confirmLabel: "Disconnect" }))
                  removeConnector(agent.id, c.id);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ListCard>

      <ListCard title="Connect a service" hint="Tokens are validated against the live API and stored only on this device.">
        {CONNECTORS.map((c) => {
          const connected = owned.has(c.provider);
          const open = active === c.provider;
          return (
            <li key={c.provider}>
              <button
                disabled={connected}
                onClick={() => {
                  setActive(open ? null : c.provider);
                  setToken("");
                  setError("");
                }}
                className={clsx(ROW, "w-full text-left disabled:opacity-50")}
              >
                <span className="flex-1 text-[13px] font-medium">{c.label}</span>
                <span className="font-mono text-[11px] text-ink-3">{c.toolHint}</span>
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
                      placeholder={c.tokenLabel}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <Button variant="primary" onClick={() => connect(c.provider, c.label)} disabled={busy || !token.trim()}>
                      {busy ? <Spinner size={14} /> : "Validate & connect"}
                    </Button>
                  </div>
                  {error && <div className="text-xs text-danger">{error}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ListCard>
    </div>
  );
}

/* ------------------------------- Memory -------------------------------- */
function MemorySection({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const notes = useMemory((s) => s.notes);
  const removeNote = useMemory((s) => s.remove);
  const clearAgent = useMemory((s) => s.clearAgent);
  const approve = useMemory((s) => s.approve);
  const reject = useMemory((s) => s.reject);
  const updateAgent = useGaps((s) => s.updateAgent);
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const mine = notes.filter((n) => n.agentId === agent.id && n.status !== "pending");
  const pending = notes.filter((n) => n.agentId === agent.id && n.status === "pending");

  // "Saves memories itself" IS the Memory skill — one switch, shown here
  // where it matters, not a second setting.
  const skill = agent.skills.find((s) => s.kind === "memory");
  const selfSaving = !!skill?.enabled;
  const setSelfSaving = (on: boolean) => {
    if (skill) toggleSkill(agent.id, skill.id);
    else if (on) addSkill(agent.id, { name: "Memory", kind: "memory", description: "Save facts to remember", enabled: true });
  };

  return (
    <ListCard
      title="Memory"
      hint="Short facts this agent keeps across conversations. The relevant ones are handed to it before every answer."
      action={
        <div className="flex items-center gap-2">
          {mine.length > 0 && (
            <Button
              variant="ghost"
              className="hover:text-danger"
              onClick={async () => {
                if (await confirm({ title: `Forget everything ${agent.name} remembers?`, body: `All ${mine.length} memories are deleted. This can't be undone.`, confirmLabel: "Forget all" }))
                  clearAgent(agent.id);
              }}
            >
              Forget all
            </Button>
          )}
          <AddMemoryButton agentId={agent.id} label="Add" />
        </div>
      }
    >
      <li className="space-y-3 px-5 py-3.5">
        <Toggle
          checked={selfSaving}
          onChange={setSelfSaving}
          label="Let the agent save memories itself"
          description="It notes preferences, names and decisions as it works."
        />
        <Toggle
          checked={!!agent.reviewMemory}
          disabled={!selfSaving}
          onChange={(on) => updateAgent(agent.id, { reviewMemory: on })}
          label="Ask me before keeping them"
          description="New facts wait below until you keep or discard them."
        />
      </li>
      {pending.map((n) => (
        <li key={n.id} className={clsx(ROW, "items-start bg-warn/[0.04]")}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-label="Waiting for your OK" />
          <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => reject(n.id)}>
            Discard
          </Button>
          <Button variant="primary" icon="check" className="h-7 px-2 text-xs" onClick={() => approve(n.id)}>
            Keep
          </Button>
        </li>
      ))}
      {mine.length === 0 && pending.length === 0 ? (
        <li className="px-5 py-5 text-center text-xs text-ink-3">Nothing remembered yet.</li>
      ) : (
        mine.map((n) => (
          <li key={n.id} className={clsx(ROW, "items-start")}>
            <div className="min-w-0 flex-1 text-[13px]">{n.text}</div>
            <span className="num shrink-0 pt-0.5 text-[11px] text-ink-3">{relativeTime(n.createdAt)}</span>
            <button className={clsx(ICON_BTN, "-my-1")} aria-label="Forget" onClick={() => removeNote(n.id)}>
              <Icon name="x" size={14} />
            </button>
          </li>
        ))
      )}
    </ListCard>
  );
}

/* -------------------------------- Logs --------------------------------- */
function LogsTab({ agent }: { agent: Agent }) {
  const allRuns = useRuns((s) => s.runs);
  const runs = allRuns.filter((r) => r.agentId === agent.id);
  if (runs.length === 0) {
    return (
      <Card>
        <EmptyState icon="activity" title="No runs yet" body="Runs appear here after you chat with this agent." />
      </Card>
    );
  }
  return (
    <ListCard title="Runs" hint={`${runs.length} for this agent`}>
      {runs.map((r) => (
        <li key={r.id} className={ROW}>
          <StatusDot status={r.status === "success" ? "live" : r.status === "error" ? "error" : r.status === "running" ? "ready" : "draft"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{r.summary || r.trigger}</div>
            <div className="text-[11px] text-ink-3">
              {r.trigger} · {relativeTime(r.startedAt)} · {r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "running"}
            </div>
          </div>
          <span className="hidden w-16 text-right font-mono text-[11px] text-ink-3 sm:block">{fmtTokens(r.tokensIn + r.tokensOut)} tok</span>
          <span className="w-14 text-right font-mono text-[11px] text-ink-3">{fmtUsd(r.costUsd)}</span>
          <Badge tone={r.status === "error" ? "danger" : r.status === "success" ? "success" : "neutral"}>{r.status}</Badge>
        </li>
      ))}
    </ListCard>
  );
}
