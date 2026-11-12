/**
 * Plain-English descriptions of what an agent is doing, from its tool calls.
 * Tool names are an implementation detail ("WebSearch", "run_shell",
 * "mcp__github__search"); the chat says "Searching the web".
 */

export interface Step {
  /** While it runs: "Searching the web". */
  active: string;
  /** Once settled: "Searched the web". */
  done: string;
  /** What it acted on: the query, the site, the file. Empty when nothing useful. */
  detail: string;
  /**
   * Whether `detail` may show while the step runs. Machine actions wait on an
   * approval dialog that already shows the exact command; one copy is enough.
   */
  showDetailWhileRunning: boolean;
}

const str = (o: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) if (typeof o[k] === "string" && o[k]) return (o[k] as string).replace(/\s+/g, " ").trim();
  return "";
};

/** "https://en.wikipedia.org/wiki/Ancient_Greece" → "en.wikipedia.org/wiki/Ancient_Greece". */
function site(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

type Rule = [verb: string, past: string, detail: (o: Record<string, unknown>) => string, showWhileRunning: boolean];

const RULES: Record<string, Rule> = {
  // Web
  WebSearch: ["Searching the web", "Searched the web", (o) => str(o, "query"), true],
  web_search: ["Searching the web", "Searched the web", (o) => str(o, "query"), true],
  WebFetch: ["Reading", "Read", (o) => site(str(o, "url")), true],
  web_fetch: ["Reading", "Read", (o) => site(str(o, "url")), true],
  http_request: ["Calling", "Called", (o) => site(str(o, "url")), true],
  // Files
  Read: ["Reading a file", "Read a file", (o) => basename(str(o, "file_path", "path")), true],
  read_file: ["Reading a file", "Read a file", (o) => basename(str(o, "path")), false],
  list_files: ["Looking through a folder", "Looked through a folder", (o) => str(o, "path"), false],
  Glob: ["Looking for files", "Looked for files", (o) => str(o, "pattern"), true],
  LS: ["Looking through a folder", "Looked through a folder", (o) => str(o, "path"), true],
  Grep: ["Searching files", "Searched files", (o) => str(o, "pattern"), true],
  Write: ["Writing a file", "Wrote a file", (o) => basename(str(o, "file_path")), false],
  Edit: ["Editing a file", "Edited a file", (o) => basename(str(o, "file_path")), false],
  MultiEdit: ["Editing a file", "Edited a file", (o) => basename(str(o, "file_path")), false],
  write_file: ["Writing a file", "Wrote a file", (o) => basename(str(o, "path")), false],
  NotebookEdit: ["Editing a notebook", "Edited a notebook", (o) => basename(str(o, "notebook_path")), false],
  // Machine
  Bash: ["Running a command", "Ran a command", (o) => str(o, "description", "command"), false],
  run_shell: ["Running a command", "Ran a command", (o) => str(o, "command"), false],
  run_javascript: ["Running code", "Ran code", () => "", true],
  code_execution: ["Running code", "Ran code", () => "", true],
  screenshot: ["Looking at the screen", "Looked at the screen", () => "", true],
  click: ["Using the computer", "Used the computer", () => "", false],
  type_text: ["Using the computer", "Used the computer", () => "", false],
  press_key: ["Using the computer", "Used the computer", () => "", false],
  scroll: ["Using the computer", "Used the computer", () => "", false],
  send_file: ["Sending a file", "Sent a file", (o) => basename(str(o, "path")), false],
  // Thinking aids
  Task: ["Working on a sub-task", "Finished a sub-task", (o) => str(o, "description", "prompt"), true],
  Agent: ["Working on a sub-task", "Finished a sub-task", (o) => str(o, "description", "prompt"), true],
  TodoWrite: ["Planning the steps", "Planned the steps", () => "", true],
  // Claude Code loads some of its own tools on demand before first use.
  ToolSearch: ["Getting its tools ready", "Got its tools ready", () => "", true],
  remember: ["Saving to memory", "Saved to memory", (o) => str(o, "text"), true],
};

export function describeStep(name: string, input: unknown): Step {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rule = RULES[name];
  if (rule) {
    const [active, done, detail, showDetailWhileRunning] = rule;
    return { active, done, detail: detail(o), showDetailWhileRunning };
  }
  // MCP tools arrive as mcp__<server>__<tool>; the server is the useful part.
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  const what = mcp ? mcp[1].replace(/[-_]/g, " ") : name.replace(/_/g, " ");
  return { active: `Using ${what}`, done: `Used ${what}`, detail: str(o, "query", "url", "path", "name"), showDetailWhileRunning: false };
}

/** 7 → "0:07", 125 → "2:05". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
