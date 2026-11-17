import { useState } from "react";
import clsx from "clsx";
import { nanoid } from "nanoid";
import { Badge, Button, Card, CardHeader, Field, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { useGaps } from "@/stores/gaps";
import { splitArgs } from "@/lib/mcp";
import type { Gap, McpServer } from "@/types/domain";
import { EnvRows } from "./EnvRows";

export function McpSection({ gap }: { gap: Gap }) {
  const { confirm } = useDialog();
  const updateGap = useGaps((s) => s.updateGap);
  const servers = gap.mcpServers ?? [];
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (next: McpServer[]) => updateGap(gap.id, { mcpServers: next });
  const patch = (id: string, p: Partial<McpServer>) => update(servers.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const add = () => {
    const server: McpServer = { id: nanoid(8), name: "", transport: "stdio", command: "", args: [], enabled: true };
    update([...servers, server]);
    setOpenId(server.id);
  };

  return (
    <>
      <Card className="space-y-4">
        <CardHeader
          title="MCP servers"
          hint={
            <>
              Model Context Protocol servers mounted for every agent in this pack. On the Claude Code runtime the CLI
              spawns/connects them and their tools become available as{" "}
              <code className="font-mono">mcp__&lt;server&gt;__*</code>.
            </>
          }
          action={
            <Button icon="plus" onClick={add}>
              Add MCP server
            </Button>
          }
        />
        {servers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink-3">
            No MCP servers yet.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {servers.map((s) => {
              const open = openId === s.id;
              return (
                <div key={s.id}>
                  <button
                    onClick={() => setOpenId(open ? null : s.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <Icon name="plug" size={14} className="text-ink-3" />
                    <span className="flex-1 truncate font-mono text-[13px]">{s.name || "unnamed server"}</span>
                    <Badge>{s.transport}</Badge>
                    <Badge tone={s.enabled ? "success" : "neutral"}>{s.enabled ? "enabled" : "off"}</Badge>
                    <Icon
                      name="chevron"
                      size={14}
                      className={clsx("text-ink-3 transition-transform", open && "rotate-90")}
                    />
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-border bg-surface-2/30 p-3.5">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Name" hint="Tool namespace, e.g. github.">
                          <input
                            className="input font-mono"
                            value={s.name}
                            onChange={(e) => patch(s.id, { name: e.target.value })}
                          />
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
                            <input
                              className="input font-mono"
                              value={s.command ?? ""}
                              onChange={(e) => patch(s.id, { command: e.target.value })}
                            />
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
                          <input
                            className="input font-mono"
                            value={s.url ?? ""}
                            onChange={(e) => patch(s.id, { url: e.target.value })}
                          />
                        </Field>
                      )}
                      <div className="flex items-center justify-between border-t border-border pt-3">
                        <Toggle checked={s.enabled} onChange={(on) => patch(s.id, { enabled: on })} label="Enabled" />
                        <Button
                          variant="danger"
                          icon="trash"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `Remove MCP server "${s.name || "unnamed"}"?`,
                                confirmLabel: "Remove",
                              })
                            )
                              update(servers.filter((x) => x.id !== s.id));
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
        <p className="text-xs text-ink-3">
          MCP tools run on the Claude Code runtime (desktop). The API runtime uses the agent's built-in skills and
          connectors instead.
        </p>
      </Card>
    </>
  );
}
