/**
 * Tool registry. Turns an agent's enabled skills and connected services into
 * real, executable tools for the Claude tool-use loop.
 *
 *  - web_search + web_fetch → Anthropic's server-side search and full-page reading
 *  - code_execution → Anthropic's server-side Python sandbox (alongside run_javascript)
 *  - http   (web.ts)       → http_request
 *  - code   (web.ts)       → run_javascript in a Web Worker
 *  - files  (files.ts)     → read_file, list_files
 *  - memory (memory.ts)    → remember
 *  - computer (computer.ts)→ run_shell, write_file, send_file, screenshot, click, type_text, press_key, scroll
 *  - connectors (connectors.ts) → github/slack/notion API calls
 *
 * To add a tool: write it in the matching module and list it in SKILL_TOOLS.
 * To remove one: delete it from SKILL_TOOLS.
 */
import type { Agent, Skill } from "@/types/domain";
import type { AnyTool } from "../claude";
import { newTurn } from "../approval";
import { webFetchToolType, webSearchToolType } from "../aiConfig";
import { errorMessage } from "../runError";
import { httpTool, jsTool } from "./web";
import { fileTools } from "./files";
import { rememberTool } from "./memory";
import { computerTools } from "./computer";
import { connectorTools } from "./connectors";
import { UNTRUSTED_OUTPUT, fenceUntrusted, shellOutputHasContent } from "./untrusted";
import type { ClientTool, Executor, ToolContext, ToolInput, ToolOutput } from "./types";

export type { ClientTool, Executor, ToolContext, ToolImage, ToolInput, ToolOutput } from "./types";
export { outputText } from "./types";
export { sendImageToChannel } from "./computer";
export { cliResultIsUntrusted } from "./untrusted";

const SKILL_TOOLS: Partial<Record<Skill["kind"], ClientTool[]>> = {
  http: [httpTool],
  code: [jsTool],
  files: fileTools,
  memory: [rememberTool],
  computer: computerTools,
};

const SERVER_TOOL_MAX_USES = 5;
const WEB_FETCH_MAX_TOKENS = 20_000;
const CODE_EXECUTION_TOOL = "code_execution_20260521";
/** Web search versions that already run their own code sandbox. */
const SEARCH_WITH_SANDBOX = "web_search_20260209";

export interface AssembledTools {
  /** Tool definitions to pass to the API (client + server tools). */
  defs: AnyTool[];
  /** Executors keyed by tool name (client tools only). */
  executors: Record<string, Executor>;
}

/** Server-side tools, executed by Anthropic — they need no client executor. */
function serverTools(agent: Agent, enabled: Set<Skill["kind"]>): AnyTool[] {
  const defs: AnyTool[] = [];
  const searchType = webSearchToolType(agent.model);
  if (enabled.has("web_search")) {
    // Search finds pages; fetch reads them in full instead of working from snippets.
    defs.push({ type: searchType, name: "web_search", max_uses: SERVER_TOOL_MAX_USES } as AnyTool);
    defs.push({
      type: webFetchToolType(agent.model),
      name: "web_fetch",
      max_uses: SERVER_TOOL_MAX_USES,
      max_content_tokens: WEB_FETCH_MAX_TOKENS,
    } as AnyTool);
  }
  // The newer web tools already run a code sandbox for filtering; declaring a
  // second one alongside them confuses the model, so it only rides alone.
  if (enabled.has("code") && !(enabled.has("web_search") && searchType === SEARCH_WITH_SANDBOX)) {
    defs.push({ type: CODE_EXECUTION_TOOL, name: "code_execution" } as AnyTool);
  }
  return defs;
}

/** Build the tool set for an agent from its enabled skills + connectors. */
export function buildTools(agent: Agent): AssembledTools {
  const enabled = new Set(agent.skills.filter((s) => s.enabled).map((s) => s.kind));
  const defs = serverTools(agent, enabled);
  const executors: Record<string, Executor> = {};

  const client = [...[...enabled].flatMap((kind) => SKILL_TOOLS[kind] ?? []), ...connectorTools(agent)];
  for (const t of client) {
    if (executors[t.def.name]) continue; // first one wins
    defs.push(t.def);
    executors[t.def.name] = t.run;
  }
  return { defs, executors };
}

/**
 * Tools the Claude Code CLI already has natively (Bash, Read, Write,
 * WebFetch…). Everything else an agent has — memory, connectors, send_file,
 * desktop control — reaches the CLI over the tool bridge.
 */
const CLI_NATIVE = new Set(["run_shell", "read_file", "list_files", "write_file", "http_request", "run_javascript"]);

export function buildCliBridgeTools(agent: Agent): AssembledTools {
  const { defs, executors } = buildTools(agent);
  const keep = (name: string) => !CLI_NATIVE.has(name) && !!executors[name];
  return {
    defs: defs.filter((d) => "input_schema" in d && keep(d.name)),
    executors: Object.fromEntries(Object.entries(executors).filter(([n]) => keep(n))),
  };
}

/** Execute a single tool by name; never throws (returns an error string). */
export async function runTool(
  name: string,
  input: ToolInput,
  executors: Record<string, Executor>,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const exec = executors[name];
  if (!exec) return `Error: unknown tool "${name}".`;
  ctx.turn ??= newTurn();
  ctx.onActivity?.(name);
  try {
    const out = await exec(input, ctx);
    if (typeof out !== "string" || !UNTRUSTED_OUTPUT.has(name) || out.startsWith("Error")) return out;
    // Only real output (a page, a file, stdout/stderr) taints the turn.
    if (name !== "run_shell" || shellOutputHasContent(out)) ctx.turn.untrusted = true;
    return fenceUntrusted(name, out);
  } catch (e) {
    return `Error running ${name}: ${errorMessage(e)}`;
  }
}
