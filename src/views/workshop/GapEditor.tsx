import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { nanoid } from "nanoid";
import { Button, Card, Badge, EmptyState, Field, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { useBrains } from "@/stores/brains";
import { downloadGap, encodeShareCode } from "@/lib/gapfile";
import { splitArgs } from "@/lib/mcp";
import { MODELS, type Agent, type AgentStatus, type Gap, type McpServer, type ModelId } from "@/types/domain";
import { useDialog } from "@/components/Confirm";

type Section = "identity" | "agents" | "mcp" | "environment" | "advanced";
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "identity", label: "Identity", icon: "edit" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "mcp", label: "MCP servers", icon: "plug" },
  { id: "environment", label: "Environment", icon: "terminal" },
  { id: "advanced", label: "Advanced", icon: "settings" },
];

const COLORS = ["#6D5BFF", "#40C98E", "#F0B446", "#F46060", "#4FA8FF", "#C46DFF"];

/**
 * Pack editor — the Workshop's deep-editing surface for one GAP. Everything a
 * `.gap` file carries is editable here: identity, the agents inside, and a raw
 * JSON escape hatch for anything the form doesn't surface.
 */
export function GapEditorView() {
  const { notify } = useDialog();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const gap = useGaps((s) => s.findGap(id));
  const [section, setSection] = useState<Section>("identity");

  if (!gap) {
    return (
      <div className="p-7">
        <EmptyState
          icon="grid"
          title="GAP not found"
          action={<Button onClick={() => navigate("/workshop")}>Back to Workshop</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-border px-7 py-4">
        <button onClick={() => navigate("/workshop")} className="btn-ghost p-1.5">
          <Icon name="chevron" size={18} className="rotate-180" />
        </button>
        <span
          className="grid h-10 w-10 place-items-center rounded-lg text-xl"
          style={{ background: `${gap.color}22` }}
        >
          {gap.emoji}
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{gap.name}</h1>
          <div className="text-xs text-ink-3">
            Pack editor · v{gap.version} · {gap.agents.length} agent{gap.agents.length === 1 ? "" : "s"}
          </div>
        </div>
        <Button icon="download" onClick={async () => {
              try {
                await downloadGap(gap);
              } catch (e) {
                notify("Export failed", (e as Error).message);
              }
            }}>
          Export .gap
        </Button>
        <Button icon="grid" onClick={() => navigate(`/gaps/${gap.id}`)}>
          Open GAP page
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[190px] shrink-0 border-r border-border p-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={clsx(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                section === s.id ? "bg-brand/12 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon name={s.icon} size={16} className={section === s.id ? "text-brand-2" : "text-ink-3"} />
              {s.label}
              {s.id === "agents" && (
                <span className="ml-auto font-mono text-[0.62rem] text-ink-3">{gap.agents.length}</span>
              )}
            </button>
          ))}
        </aside>

        <div className="flex-1 overflow-y-auto p-7">
          <div className="mx-auto max-w-2xl space-y-6">
            {section === "identity" && <IdentitySection gap={gap} />}
            {section === "agents" && <AgentsSection gap={gap} />}
            {section === "mcp" && <McpSection gap={gap} />}
            {section === "environment" && <EnvironmentSection gap={gap} />}
            {section === "advanced" && <AdvancedSection gap={gap} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Identity ------------------------------- */
function IdentitySection({ gap }: { gap: Gap }) {
  const updateGap = useGaps((s) => s.updateGap);
  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Identity</h3>
      <div className="grid grid-cols-[80px_1fr] gap-4">
        <Field label="Emoji">
          <input
            className="input text-center"
            value={gap.emoji}
            onChange={(e) => updateGap(gap.id, { emoji: e.target.value })}
          />
        </Field>
        <Field label="Name">
          <input
            className="input"
            value={gap.name}
            onChange={(e) => updateGap(gap.id, { name: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className="input min-h-[70px] resize-y"
          value={gap.description}
          onChange={(e) => updateGap(gap.id, { description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Version" hint="Bump when you share a new revision.">
          <input
            className="input"
            value={gap.version}
            onChange={(e) => updateGap(gap.id, { version: e.target.value })}
          />
        </Field>
        <Field label="Author">
          <input
            className="input"
            value={gap.author}
            onChange={(e) => updateGap(gap.id, { author: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Tags" hint="Comma-separated.">
        <input
          className="input"
          value={gap.tags.join(", ")}
          onChange={(e) =>
            updateGap(gap.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
          }
        />
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateGap(gap.id, { color: c })}
              className={clsx("h-8 w-8 rounded-full border-2", gap.color === c ? "border-ink" : "border-transparent")}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
    </Card>
  );
}

/* ------------------------------- Agents -------------------------------- */
function AgentsSection({ gap }: { gap: Gap }) {
  const addAgent = useGaps((s) => s.addAgent);
  const [openId, setOpenId] = useState<string | null>(gap.agents[0]?.id ?? null);

  return (
    <>
      {gap.agents.length === 0 ? (
        <EmptyState
          icon="agents"
          title="No agents in this pack"
          action={
            <Button variant="primary" icon="plus" onClick={() => addAgent(gap.id, { name: "New agent", role: "Assistant" })}>
              Add agent
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {gap.agents.map((a) => (
            <AgentRow key={a.id} agent={a} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
          ))}
        </div>
      )}
      {gap.agents.length > 0 && (
        <Button icon="plus" onClick={() => addAgent(gap.id, { name: "New agent", role: "Assistant" })}>
          Add agent
        </Button>
      )}
    </>
  );
}

function AgentRow({ agent, open, onToggle }: { agent: Agent; open: boolean; onToggle: () => void }) {
  const { confirm } = useDialog();
  const updateAgent = useGaps((s) => s.updateAgent);
  const deleteAgent = useGaps((s) => s.deleteAgent);
  const brains = useBrains((s) => s.brains);
  const statuses: AgentStatus[] = ["draft", "ready", "live", "paused"];

  return (
    <Card className="p-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="text-xl">{agent.emoji}</span>
        <div className="flex-1">
          <div className="text-sm font-medium">{agent.name}</div>
          <div className="text-xs text-ink-3">{agent.role}</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-2">
          <StatusDot status={agent.status} />
          {agent.status}
        </div>
        <Icon name="chevron" size={15} className={clsx("text-ink-3 transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid grid-cols-[64px_1fr_1fr] gap-3">
            <Field label="Emoji">
              <input
                className="input text-center"
                value={agent.emoji}
                onChange={(e) => updateAgent(agent.id, { emoji: e.target.value })}
              />
            </Field>
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
          <div className="grid grid-cols-3 gap-3">
            <Field label="Model">
              <select
                className="input"
                value={agent.model}
                onChange={(e) => updateAgent(agent.id, { model: e.target.value as ModelId })}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                className="input"
                value={agent.status}
                onChange={(e) => updateAgent(agent.id, { status: e.target.value as AgentStatus })}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Brain">
              <select
                className="input"
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
            </Field>
          </div>
          <SystemPromptField agent={agent} />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Badge>{agent.skills.length} skills</Badge>
              <Badge>{agent.knowledge.length} docs</Badge>
              <Link to={`/agents/${agent.id}`} className="text-brand-2 hover:underline">
                Open full agent →
              </Link>
            </div>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (await confirm({ title: `Remove "${agent.name}"?`, body: "The agent and its configuration are removed from this pack.", confirmLabel: "Remove" })) deleteAgent(agent.id);
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SystemPromptField({ agent }: { agent: Agent }) {
  const updateAgent = useGaps((s) => s.updateAgent);
  const [draft, setDraft] = useState(agent.systemPrompt);
  const dirty = draft !== agent.systemPrompt;
  return (
    <Field label="System prompt">
      <textarea
        className="input min-h-[110px] resize-y font-mono text-[0.82rem] leading-relaxed"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {dirty && (
        <div className="mt-2 flex justify-end">
          <Button variant="primary" icon="check" onClick={() => updateAgent(agent.id, { systemPrompt: draft })}>
            Save prompt
          </Button>
        </div>
      )}
    </Field>
  );
}

/* ----------------------------- MCP servers ----------------------------- */
function McpSection({ gap }: { gap: Gap }) {
  const { confirm } = useDialog();
  const updateGap = useGaps((s) => s.updateGap);
  const servers = gap.mcpServers ?? [];
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (next: McpServer[]) => updateGap(gap.id, { mcpServers: next });
  const patch = (id: string, p: Partial<McpServer>) =>
    update(servers.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const add = () => {
    const server: McpServer = { id: nanoid(8), name: "", transport: "stdio", command: "", args: [], enabled: true };
    update([...servers, server]);
    setOpenId(server.id);
  };

  return (
    <>
      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">MCP servers</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Model Context Protocol servers mounted for every agent in this pack. On the Claude Code runtime the CLI
            spawns/connects them and their tools become available as <code className="font-mono">mcp__&lt;server&gt;__*</code>.
          </p>
        </div>
        {servers.length === 0 ? (
          <p className="text-sm text-ink-3">No MCP servers yet.</p>
        ) : (
          <div className="space-y-2">
            {servers.map((s) => {
              const open = openId === s.id;
              return (
                <div key={s.id} className="rounded-lg border border-border">
                  <button
                    onClick={() => setOpenId(open ? null : s.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                  >
                    <Icon name="plug" size={15} className="text-ink-3" />
                    <span className="flex-1 text-sm font-medium">{s.name || "unnamed server"}</span>
                    <Badge>{s.transport}</Badge>
                    <Badge tone={s.enabled ? "success" : "neutral"}>{s.enabled ? "enabled" : "off"}</Badge>
                    <Icon name="chevron" size={14} className={clsx("text-ink-3 transition-transform", open && "rotate-90")} />
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-border p-3.5">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Name" hint="Tool namespace, e.g. github.">
                          <input className="input font-mono" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} />
                        </Field>
                        <Field label="Transport">
                          <select
                            className="input"
                            value={s.transport}
                            onChange={(e) => patch(s.id, { transport: e.target.value as McpServer["transport"] })}
                          >
                            <option value="stdio">stdio (local command)</option>
                            <option value="http">http (remote URL)</option>
                          </select>
                        </Field>
                      </div>
                      {s.transport === "stdio" ? (
                        <>
                          <Field label="Command" hint="Executable to spawn, e.g. npx.">
                            <input className="input font-mono" value={s.command ?? ""} onChange={(e) => patch(s.id, { command: e.target.value })} />
                          </Field>
                          <Field label="Arguments" hint="Space-separated, e.g. -y @modelcontextprotocol/server-github.">
                            <input
                              className="input font-mono"
                              value={(s.args ?? []).join(" ")}
                              onChange={(e) => patch(s.id, { args: splitArgs(e.target.value) })}
                            />
                          </Field>
                          <EnvRows
                            label="Server environment"
                            hint="KEY=value pairs passed to the spawned server."
                            env={s.env ?? {}}
                            onChange={(env) => patch(s.id, { env })}
                          />
                        </>
                      ) : (
                        <Field label="URL" hint="Remote MCP endpoint.">
                          <input className="input font-mono" value={s.url ?? ""} onChange={(e) => patch(s.id, { url: e.target.value })} />
                        </Field>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={s.enabled} onChange={(e) => patch(s.id, { enabled: e.target.checked })} className="accent-brand" />
                          Enabled
                        </label>
                        <Button
                          variant="danger"
                          icon="trash"
                          onClick={async () => {
                            if (await confirm({ title: `Remove MCP server "${s.name || "unnamed"}"?`, confirmLabel: "Remove" })) update(servers.filter((x) => x.id !== s.id));
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <Button icon="plus" onClick={add}>
          Add MCP server
        </Button>
        <p className="text-xs text-ink-3">
          MCP tools run on the Claude Code runtime (desktop). The API runtime uses the agent's built-in skills and
          connectors instead.
        </p>
      </Card>
    </>
  );
}

/* ----------------------------- Environment ----------------------------- */
function EnvironmentSection({ gap }: { gap: Gap }) {
  const updateGap = useGaps((s) => s.updateGap);
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold">Environment</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          Variables injected into this pack's Claude Code runs and its MCP servers. Stored locally with the GAP.
        </p>
      </div>
      <EnvRows label="Variables" env={gap.env ?? {}} onChange={(env) => updateGap(gap.id, { env })} />
    </Card>
  );
}

/** Key/value editor for env maps. Rows edit in place; blank keys are dropped on blur. */
function EnvRows({
  label,
  hint,
  env,
  onChange,
}: {
  label: string;
  hint?: string;
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}) {
  // Local row state so keys can be edited without immediately re-keying the map.
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(env).map(([k, v]) => ({ k, v })),
  );

  const commit = (next: { k: string; v: string }[]) => {
    setRows(next);
    const out: Record<string, string> = {};
    for (const { k, v } of next) if (k.trim()) out[k.trim()] = v;
    onChange(out);
  };

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input w-2/5 font-mono"
              placeholder="KEY"
              value={row.k}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
            />
            <span className="text-ink-3">=</span>
            <input
              className="input flex-1 font-mono"
              placeholder="value"
              value={row.v}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
            />
            <button
              className="btn-ghost p-1.5 text-ink-3 hover:text-danger"
              onClick={() => commit(rows.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
        <Button icon="plus" onClick={() => setRows([...rows, { k: "", v: "" }])}>
          Add variable
        </Button>
      </div>
    </Field>
  );
}

/* ------------------------------ Advanced ------------------------------- */
function AdvancedSection({ gap }: { gap: Gap }) {
  const { confirm, notify } = useDialog();
  const updateGap = useGaps((s) => s.updateGap);
  const deleteGap = useGaps((s) => s.deleteGap);
  const navigate = useNavigate();

  const pretty = useMemo(() => JSON.stringify(gap, null, 2), [gap]);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState("");
  const dirty = text !== pretty;

  const save = () => {
    setError("");
    try {
      const parsed = JSON.parse(text) as Gap;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The manifest must be a JSON object.");
      }
      if (!Array.isArray(parsed.agents)) throw new Error("`agents` must be an array.");
      // The id is the store key — it can't be renamed here. Agents always
      // belong to this pack regardless of what the buffer says.
      updateGap(gap.id, {
        ...parsed,
        id: gap.id,
        agents: parsed.agents.map((a) => ({ ...a, gapId: gap.id })),
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Raw manifest</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              The whole GAP as JSON — the escape hatch for anything the form doesn't surface. Saving replaces the pack.
            </p>
          </div>
          {dirty && (
            <Button variant="primary" icon="check" onClick={save}>
              Save manifest
            </Button>
          )}
        </div>
        <textarea
          className="input min-h-[340px] resize-y font-mono text-xs leading-relaxed"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <div className="text-xs text-danger">{error}</div>}
        {dirty && (
          <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setText(pretty)}>
            Discard buffer and reload from the pack
          </button>
        )}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Share</h3>
        <div className="flex gap-2">
          <Button className="flex-1" icon="download" onClick={async () => {
              try {
                await downloadGap(gap);
              } catch (e) {
                notify("Export failed", (e as Error).message);
              }
            }}>
            Export .gap file
          </Button>
          <Button
            className="flex-1"
            icon="copy"
            onClick={() => {
              void navigator.clipboard.writeText(encodeShareCode(gap));
              notify("Share code copied", "Paste it into another Forge install to import this pack.");
            }}
          >
            Copy share code
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Danger zone</h3>
        <div className="flex items-center justify-between">
          <div className="text-sm text-ink-2">Delete this GAP and all its agents. This can't be undone.</div>
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (await confirm({ title: `Delete "${gap.name}"?`, body: `This GAP and its ${gap.agents.length} agent(s), with their chats and knowledge, are deleted.` })) {
                deleteGap(gap.id);
                navigate("/workshop");
              }
            }}
          >
            Delete GAP
          </Button>
        </div>
      </Card>
    </>
  );
}
