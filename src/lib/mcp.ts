import type { Gap, McpServer } from "@/types/domain";

/**
 * Build the `--mcp-config` JSON the Claude Code CLI expects from a GAP's
 * enabled MCP servers. Returns undefined when the pack mounts none, so the
 * caller can skip the flag entirely.
 *
 * CLI shape: { "mcpServers": { "<name>": { command, args, env } | { type: "http", url } } }
 */
export function buildMcpConfig(gap: Pick<Gap, "mcpServers">): string | undefined {
  const enabled = (gap.mcpServers ?? []).filter(isRunnable);
  if (enabled.length === 0) return undefined;

  const servers: Record<string, unknown> = {};
  for (const s of enabled) {
    servers[s.name] =
      s.transport === "http"
        ? { type: "http", url: s.url }
        : {
            command: s.command,
            ...(s.args && s.args.length > 0 ? { args: s.args } : {}),
            ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
          };
  }
  return JSON.stringify({ mcpServers: servers });
}

function isRunnable(s: McpServer): boolean {
  if (!s.enabled || !s.name.trim()) return false;
  return s.transport === "http" ? !!s.url?.trim() : !!s.command?.trim();
}

/** Split a shell-ish arg string ("--flag value") into an args array. */
export function splitArgs(input: string): string[] {
  return input.split(/\s+/).filter(Boolean);
}
