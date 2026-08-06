/**
 * Tool registry. Turns an agent's enabled skills and connected services into
 * real, executable tools for the Claude tool-use loop.
 *
 *  - web_search   → Anthropic's server-side web search tool (executed by the API)
 *  - http_request → real network call (native on desktop, fetch on web)
 *  - run_javascript → sandboxed JS execution in a Web Worker
 *  - read_file    → reads a local file (desktop only)
 *  - remember / recall → persistent agent memory
 *  - connector tools (github/slack/notion/linear/...) → real provider API calls
 */

import type { Agent } from "@/types/domain";
import type { AnyTool, ToolDef } from "./claude";
import { httpFetch } from "./http";
import { isDesktop } from "./platform";
import { useMemory } from "@/stores/memory";
import { brainFor, memoryKeyFor } from "@/stores/brains";

export interface ToolContext {
  agent: Agent;
  /** Optional progress callback (e.g. to surface "ran web_search" in the UI). */
  onActivity?: (label: string) => void;
}

type Executor = (input: any, ctx: ToolContext) => Promise<string>;

interface ClientTool {
  def: ToolDef;
  run: Executor;
}

/* ----------------------------- Skill tools ---------------------------- */

const httpTool: ClientTool = {
  def: {
    name: "http_request",
    description:
      "Make an HTTP request to a URL and return the response body. Use for calling public APIs or fetching web pages.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
        headers: { type: "object", description: "Optional request headers" },
        body: { type: "string", description: "Optional request body" },
      },
      required: ["url"],
    },
  },
  run: async (input) => {
    const r = await httpFetch({ method: input.method, url: input.url, headers: input.headers, body: input.body });
    return `HTTP ${r.status}\n${r.body.slice(0, 6000)}`;
  },
};

const jsTool: ClientTool = {
  def: {
    name: "run_javascript",
    description:
      "Execute JavaScript in a sandbox and return the value of the last expression (or anything logged). Use for calculations and data manipulation. No network or DOM access.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript source to run" } },
      required: ["code"],
    },
  },
  run: async (input) => runInWorker(String(input.code ?? "")),
};

const fileTool: ClientTool = {
  def: {
    name: "read_file",
    description: "Read a UTF-8 text file from the local filesystem by absolute path (desktop only).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"],
    },
  },
  run: async (input) => {
    if (!isDesktop()) return "Error: read_file is only available in the desktop app.";
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(String(input.path));
      return text.slice(0, 8000);
    } catch (e: any) {
      return `Error reading file: ${e?.message ?? e}`;
    }
  },
};

const rememberTool: ClientTool = {
  def: {
    name: "remember",
    description: "Save a short fact to long-term memory so you can recall it in future conversations.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The fact to remember" } },
      required: ["text"],
    },
  },
  run: async (input, ctx) => {
    // A brain with shared memory pools notes across every agent wearing it.
    // A brain with the learning queue on holds facts for review instead.
    const key = memoryKeyFor(ctx.agent);
    if (brainFor(ctx.agent)?.reviewLearning) {
      useMemory.getState().propose(key, String(input.text ?? ""), ctx.agent.name);
      return "Queued for review — this fact will stick once approved in the brain's Learning list.";
    }
    useMemory.getState().remember(key, String(input.text ?? ""));
    return "Saved to memory.";
  },
};

const recallTool: ClientTool = {
  def: {
    name: "recall",
    description: "Search your long-term memory for facts relevant to a query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up" } },
      required: ["query"],
    },
  },
  run: async (input, ctx) => {
    const hits = useMemory.getState().recall(memoryKeyFor(ctx.agent), String(input.query ?? ""));
    return hits.length ? hits.map((h) => `- ${h.text}`).join("\n") : "No relevant memories.";
  },
};

/* --------------------------- Connector tools -------------------------- */

function connectorTools(agent: Agent): ClientTool[] {
  const tools: ClientTool[] = [];
  for (const c of agent.connectors) {
    if (c.status !== "connected") continue;
    const token = c.scopes?.[0] ?? ""; // token stored in scopes[0] (see ConnectionsTab)
    switch (c.provider) {
      case "github":
        tools.push({
          def: {
            name: "github_api",
            description:
              "Call the GitHub REST API. Provide a path like '/repos/owner/repo/issues'. Returns JSON.",
            input_schema: {
              type: "object",
              properties: { path: { type: "string" }, method: { type: "string", default: "GET" }, body: { type: "string" } },
              required: ["path"],
            },
          },
          run: async (input) => {
            const r = await httpFetch({
              method: input.method ?? "GET",
              url: `https://api.github.com${input.path}`,
              headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "Forge",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: input.body,
            });
            return `HTTP ${r.status}\n${r.body.slice(0, 6000)}`;
          },
        });
        break;
      case "slack":
        tools.push({
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
        break;
      case "notion":
        tools.push({
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
            return r.body.slice(0, 6000);
          },
        });
        break;
      default:
        break;
    }
  }
  return tools;
}

/* ------------------------------- Assembly ----------------------------- */

const SKILL_TOOLS: Record<string, ClientTool[]> = {
  http: [httpTool],
  code: [jsTool],
  files: [fileTool],
  memory: [rememberTool, recallTool],
};

export interface AssembledTools {
  /** Tool definitions to pass to the API (client + server tools). */
  defs: AnyTool[];
  /** Executors keyed by tool name (client tools only). */
  executors: Record<string, Executor>;
}

/** Build the tool set for an agent from its enabled skills + connectors. */
export function buildTools(agent: Agent): AssembledTools {
  const defs: AnyTool[] = [];
  const executors: Record<string, Executor> = {};
  const client: ClientTool[] = [];

  for (const skill of agent.skills) {
    if (!skill.enabled) continue;
    if (skill.kind === "web_search") {
      // Server-side tool, executed by Anthropic — no client executor.
      defs.push({ type: "web_search_20250305", name: "web_search", max_uses: 3 } as AnyTool);
      continue;
    }
    for (const t of SKILL_TOOLS[skill.kind] ?? []) client.push(t);
  }

  client.push(...connectorTools(agent));

  // De-dupe by name.
  const seen = new Set<string>();
  for (const t of client) {
    if (seen.has(t.def.name)) continue;
    seen.add(t.def.name);
    defs.push(t.def);
    executors[t.def.name] = t.run;
  }

  return { defs, executors };
}

/** Execute a single tool by name; never throws (returns an error string). */
export async function runTool(
  name: string,
  input: any,
  executors: Record<string, Executor>,
  ctx: ToolContext,
): Promise<string> {
  const exec = executors[name];
  if (!exec) return `Error: unknown tool "${name}".`;
  ctx.onActivity?.(name);
  try {
    return await exec(input, ctx);
  } catch (e: any) {
    return `Error running ${name}: ${e?.message ?? e}`;
  }
}

/* --------------------------- JS sandbox ------------------------------- */

function runInWorker(code: string, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    const src = `self.onmessage=async(e)=>{const logs=[];const console={log:(...a)=>logs.push(a.map(String).join(' '))};try{const fn=new Function('console','return (async()=>{'+e.data+'\\n})()');const r=await fn(console);self.postMessage({ok:true,result:(r===undefined?'':String(r)),logs})}catch(err){self.postMessage({ok:false,result:String(err),logs})}}`;
    const blob = new Blob([src], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const done = (out: string) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => done("Error: execution timed out."), timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      const { ok, result, logs } = e.data;
      const out = [logs?.length ? logs.join("\n") : "", result ? `=> ${result}` : ""].filter(Boolean).join("\n");
      done(ok ? out || "(no output)" : `Error: ${result}`);
    };
    worker.postMessage(code);
  });
}

