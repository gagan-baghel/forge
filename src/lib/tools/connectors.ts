/**
 * Connector tools: one provider → one API tool. Adding a provider is one entry
 * in CONNECTOR_TOOLS; a provider without one simply contributes no tool.
 */
import type { Agent, Connector } from "@/types/domain";
import { httpFetch } from "../http";
import { RESPONSE_LIMIT } from "./shared";
import type { ClientTool } from "./types";

type ConnectorTool = (token: string) => ClientTool;

const github: ConnectorTool = (token) => ({
  def: {
    name: "github_api",
    description: "Call the GitHub REST API. Provide a path like '/repos/owner/repo/issues'. Returns JSON.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        method: { type: "string", default: "GET" },
        body: { type: "string" },
      },
      required: ["path"],
    },
  },
  run: async (input) => {
    const r = await httpFetch({
      method: (input.method as string | undefined) ?? "GET",
      url: `https://api.github.com${String(input.path)}`,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Forge",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: input.body as string | undefined,
    });
    return `HTTP ${r.status}\n${r.body.slice(0, RESPONSE_LIMIT)}`;
  },
});

const slack: ConnectorTool = (token) => ({
  def: {
    name: "slack_post_message",
    description: "Post a message to a Slack channel using the connected bot token.",
    input_schema: {
      type: "object",
      properties: { channel: { type: "string" }, text: { type: "string" } },
      required: ["channel", "text"],
    },
  },
  run: async (input) => {
    const r = await httpFetch({
      method: "POST",
      url: "https://slack.com/api/chat.postMessage",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: input.channel, text: input.text }),
    });
    return r.body.slice(0, 2000);
  },
});

const notion: ConnectorTool = (token) => ({
  def: {
    name: "notion_search",
    description: "Search Notion pages and databases using the connected integration token.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  run: async (input) => {
    const r = await httpFetch({
      method: "POST",
      url: "https://api.notion.com/v1/search",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: input.query }),
    });
    return r.body.slice(0, RESPONSE_LIMIT);
  },
});

const CONNECTOR_TOOLS: Partial<Record<Connector["provider"], ConnectorTool>> = { github, slack, notion };

export function connectorTools(agent: Agent): ClientTool[] {
  const tools: ClientTool[] = [];
  for (const c of agent.connectors) {
    const make = c.status === "connected" ? CONNECTOR_TOOLS[c.provider] : undefined;
    // The token is stored in scopes[0] (see ConnectionsTab).
    if (make) tools.push(make(c.scopes?.[0] ?? ""));
  }
  return tools;
}
