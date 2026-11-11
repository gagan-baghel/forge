import { describe, it, expect, beforeEach } from "vitest";
import { resetStores } from "@/test/reset";
import { buildMcpConfig, splitArgs } from "@/lib/mcp";
import type { McpServer } from "@/types/domain";

const srv = (over: Partial<McpServer>): McpServer => ({
  id: "s1",
  name: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  enabled: true,
  ...over,
});

beforeEach(() => resetStores());

describe("buildMcpConfig", () => {
  it("returns undefined when the pack mounts no runnable servers", () => {
    expect(buildMcpConfig({ mcpServers: undefined })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ enabled: false })] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ command: "" })] })).toBeUndefined();
    expect(buildMcpConfig({ mcpServers: [srv({ transport: "http", url: "" })] })).toBeUndefined();
  });

  it("builds the CLI shape for stdio and http servers", () => {
    const json = buildMcpConfig({
      mcpServers: [
        srv({ env: { GITHUB_TOKEN: "t" } }),
        srv({ id: "s2", name: "docs", transport: "http", url: "https://mcp.example.com" }),
      ],
    })!;
    const cfg = JSON.parse(json);
    expect(cfg.mcpServers.github).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "t" },
    });
    expect(cfg.mcpServers.docs).toEqual({ type: "http", url: "https://mcp.example.com" });
  });

  it("splitArgs tokenizes on whitespace", () => {
    expect(splitArgs("  -y   @scope/pkg  --flag ")).toEqual(["-y", "@scope/pkg", "--flag"]);
  });
});

