/**
 * Structural validation for data that arrives from outside the app: model
 * output, `.gap` files, and share codes.
 *
 * These all used to be cast with `as Gap` / `as Draft`, which is a promise to
 * the compiler and nothing at runtime — a model that omits `agents`, or a
 * hand-edited pack, crashed the first code path that dereferenced it. Validate
 * the fields the app actually reads, cap the sizes so a hostile or runaway
 * payload can't wedge the UI, and fail with a message that names the field.
 *
 * Deliberately hand-written: the shapes are small and adding a schema library
 * for them would cost more than it saves.
 */

/** Caps chosen to be far above any legitimate pack, far below "wedges the UI". */
const MAX_STRING = 20_000;
const MAX_AGENTS = 24;
const MAX_TAGS = 32;

export class InvalidPayload extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayload";
  }
}

const fail = (msg: string): never => {
  throw new InvalidPayload(msg);
};

export function asRecord(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(`${field} must be an object.`);
  }
  return v as Record<string, unknown>;
}

export function asString(v: unknown, field: string, opts: { max?: number; fallback?: string } = {}): string {
  if (v === undefined || v === null) {
    if (opts.fallback !== undefined) return opts.fallback;
    fail(`${field} is missing.`);
  }
  if (typeof v !== "string") fail(`${field} must be a string.`);
  const s = v as string;
  if (s.length > (opts.max ?? MAX_STRING)) fail(`${field} is too long.`);
  return s;
}

export function asStringArray(v: unknown, field: string, max = MAX_TAGS): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${field} must be an array.`);
  const arr = v as unknown[];
  if (arr.length > max) fail(`${field} has too many entries.`);
  return arr.map((x, i) => asString(x, `${field}[${i}]`, { max: 200 }));
}

export interface AgentSeed {
  name: string;
  role: string;
  emoji?: string;
  systemPrompt?: string;
}

/** Agents are the part every consumer dereferences, so they get real checks. */
export function asAgentSeeds(v: unknown, field: string): AgentSeed[] {
  if (!Array.isArray(v)) fail(`${field} must be an array of agents.`);
  const arr = v as unknown[];
  if (arr.length === 0) fail(`${field} is empty — at least one agent is required.`);
  if (arr.length > MAX_AGENTS) fail(`${field} has more than ${MAX_AGENTS} agents.`);
  return arr.map((raw, i) => {
    const a = asRecord(raw, `${field}[${i}]`);
    return {
      name: asString(a.name, `${field}[${i}].name`, { max: 200 }),
      role: asString(a.role, `${field}[${i}].role`, { max: 400, fallback: "" }),
      emoji: asString(a.emoji, `${field}[${i}].emoji`, { max: 16, fallback: "" }),
      systemPrompt: asString(a.systemPrompt, `${field}[${i}].systemPrompt`, { fallback: "" }),
    };
  });
}

/**
 * Pull the JSON object out of a model turn. Models wrap JSON in prose or code
 * fences however much you tell them not to, so slice to the outermost braces —
 * but say so plainly when there is no object at all, instead of letting
 * JSON.parse report "unexpected end of input" on an empty slice.
 */
export function extractJsonObject(raw: string, what = "response"): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    fail(`The model's ${what} did not contain a JSON object.`);
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return fail(`The model's ${what} was not valid JSON.`);
  }
}
