/**
 * Connected services. Each provider is one entry in CONNECTORS: what the UI
 * shows, how its token is checked, and the API tool it gives the agent.
 * Adding a provider is one entry; removing one is deleting it.
 */
import type { Agent, Connector } from "@/types/domain";
import { httpFetch } from "../http";
import { errorMessage } from "../runError";
import { RESPONSE_LIMIT } from "./shared";
import type { ClientTool } from "./types";

type ConnectorTool = (token: string) => ClientTool;

const GITHUB_HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "Forge" };
const notionHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});

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
      headers: { ...GITHUB_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      headers: notionHeaders(token),
      body: JSON.stringify({ query: input.query }),
    });
    return r.body.slice(0, RESPONSE_LIMIT);
  },
});

export interface ConnectorSpec {
  provider: Connector["provider"];
  label: string;
  tokenLabel: string;
  tool: ConnectorTool;
  /** Checks a token against the live API: null when it works, else why not. */
  validate: (token: string) => Promise<string | null>;
}

function slackOk(body: string): boolean {
  try {
    return JSON.parse(body).ok === true;
  } catch {
    return false;
  }
}

export const CONNECTORS: ConnectorSpec[] = [
  {
    provider: "github",
    label: "GitHub",
    tokenLabel: "Personal access token",
    tool: github,
    validate: async (token) => {
      const r = await httpFetch({
        url: "https://api.github.com/user",
        headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
      });
      return r.ok ? null : `GitHub rejected the token (HTTP ${r.status}).`;
    },
  },
  {
    provider: "slack",
    label: "Slack",
    tokenLabel: "Bot token (xoxb-…)",
    tool: slack,
    validate: async (token) => {
      const r = await httpFetch({
        method: "POST",
        url: "https://slack.com/api/auth.test",
        headers: { Authorization: `Bearer ${token}` },
      });
      return slackOk(r.body) ? null : "Slack rejected the token.";
    },
  },
  {
    provider: "notion",
    label: "Notion",
    tokenLabel: "Integration token",
    tool: notion,
    validate: async (token) => {
      const r = await httpFetch({
        method: "POST",
        url: "https://api.notion.com/v1/search",
        headers: notionHeaders(token),
        body: "{}",
      });
      return r.ok ? null : `Notion rejected the token (HTTP ${r.status}).`;
    },
  },
];

const byProvider = new Map(CONNECTORS.map((c) => [c.provider, c]));

/** Validate a token for a provider; never throws. */
export async function validateConnector(provider: Connector["provider"], token: string): Promise<string | null> {
  try {
    return (await byProvider.get(provider)?.validate(token)) ?? null;
  } catch (e) {
    return `Validation failed: ${errorMessage(e)}`;
  }
}

/** The tool name a provider gives the agent, for the UI. */
export function connectorToolName(spec: ConnectorSpec): string {
  return spec.tool("").def.name;
}

export function connectorTools(agent: Agent): ClientTool[] {
  const tools: ClientTool[] = [];
  for (const c of agent.connectors) {
    const make = c.status === "connected" ? byProvider.get(c.provider)?.tool : undefined;
    // The token is stored in scopes[0] (see ConnectionsTab).
    if (make) tools.push(make(c.scopes?.[0] ?? ""));
  }
  return tools;
}
