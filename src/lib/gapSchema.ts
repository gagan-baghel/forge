/**
 * The full shape of a pack, checked at the boundary. Every `.gap` file,
 * share code, backup and raw-manifest edit passes through `normalizeGap`
 * before the app touches it.
 *
 * Lenient on purpose: a missing field gets the default a new pack would have,
 * so older and hand-made packs keep importing. A field that is present but the
 * wrong type fails with a message naming it, because guessing what a mangled
 * value meant is how bad data gets in quietly.
 */
import {
  currentModel,
  MODELS,
  type Agent,
  type Channel,
  type Connector,
  type Gap,
  type KnowledgeDoc,
  type McpServer,
  type Skill,
} from "@/types/domain";
import { asRecord, asString, asStringArray, InvalidPayload } from "./validate";
import { slugify } from "./format";

const MAX_AGENTS = 24;
const MAX_ITEMS = 200;
/** Knowledge documents are whole files; everything else is a short string. */
const MAX_DOC_CHARS = 5_000_000;
const DEFAULT_MODEL = MODELS[0].id;

const SKILL_KINDS: Skill["kind"][] = ["web_search", "code", "files", "http", "memory", "computer", "custom"];
const PROVIDERS: Connector["provider"][] = ["slack", "github", "gmail", "notion", "linear", "google_drive", "custom"];
const CHANNEL_KINDS: Channel["kind"][] = ["telegram", "discord", "slack", "web"];

/* --------------------------------- Helpers -------------------------------- */

function str(v: unknown, field: string, fallback = "", max?: number): string {
  return asString(v, field, { fallback, max });
}

function optStr(v: unknown, field: string): string | undefined {
  return v == null ? undefined : asString(v, field);
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function list<T>(v: unknown, field: string, item: (raw: unknown, field: string) => T, max = MAX_ITEMS): T[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new InvalidPayload(`${field} must be an array.`);
  if (v.length > max) throw new InvalidPayload(`${field} has more than ${max} entries.`);
  return v.map((raw, i) => item(raw, `${field}[${i}]`));
}

function stringMap(v: unknown, field: string): Record<string, string> | undefined {
  if (v == null) return undefined;
  const r = asRecord(v, field);
  return Object.fromEntries(Object.entries(r).map(([k, val]) => [k, asString(val, `${field}.${k}`, { fallback: "" })]));
}

/** A retired id moves to its successor; one this build doesn't know falls back to the default. */
function knownModel(v: unknown): Agent["model"] {
  const id = typeof v === "string" ? currentModel(v) : undefined;
  return MODELS.some((m) => m.id === id) ? (id as Agent["model"]) : DEFAULT_MODEL;
}

/* --------------------------------- Shapes --------------------------------- */

function skill(raw: unknown, field: string): Skill {
  const s = asRecord(raw, field);
  return {
    id: str(s.id, `${field}.id`),
    name: str(s.name, `${field}.name`, "Skill", 200),
    description: str(s.description, `${field}.description`),
    kind: oneOf(s.kind, SKILL_KINDS, "custom"),
    enabled: s.enabled !== false,
  };
}

function knowledgeDoc(raw: unknown, field: string): KnowledgeDoc {
  const d = asRecord(raw, field);
  const content = str(d.content, `${field}.content`, "", MAX_DOC_CHARS);
  return {
    id: str(d.id, `${field}.id`),
    title: str(d.title, `${field}.title`, "Untitled", 500),
    content,
    source: optStr(d.source, `${field}.source`),
    bytes: num(d.bytes, content.length, 0),
    addedAt: num(d.addedAt, Date.now(), 0),
  };
}

function connector(raw: unknown, field: string): Connector {
  const c = asRecord(raw, field);
  return {
    id: str(c.id, `${field}.id`),
    provider: oneOf(c.provider, PROVIDERS, "custom"),
    label: str(c.label, `${field}.label`, "", 200),
    status: oneOf(c.status, ["connected", "disconnected"] as const, "disconnected"),
    scopes: c.scopes == null ? undefined : asStringArray(c.scopes, `${field}.scopes`),
  };
}

function channel(raw: unknown, field: string): Channel {
  const c = asRecord(raw, field);
  return {
    id: str(c.id, `${field}.id`),
    kind: oneOf(c.kind, CHANNEL_KINDS, "web"),
    label: str(c.label, `${field}.label`, "", 200),
    status: oneOf(c.status, ["active", "inactive"] as const, "inactive"),
    token: optStr(c.token, `${field}.token`),
    config: stringMap(c.config, `${field}.config`),
    owners: c.owners == null ? undefined : list(c.owners, `${field}.owners`, owner),
    remoteControl: c.remoteControl === true ? true : undefined,
  };
}

function owner(raw: unknown, field: string) {
  const o = asRecord(raw, field);
  return {
    id: str(o.id, `${field}.id`),
    name: str(o.name, `${field}.name`),
    chatId: str(o.chatId, `${field}.chatId`),
    pairedAt: num(o.pairedAt, 0, 0),
  };
}

function mcpServer(raw: unknown, field: string): McpServer {
  const s = asRecord(raw, field);
  return {
    id: str(s.id, `${field}.id`),
    name: str(s.name, `${field}.name`, "", 200),
    transport: oneOf(s.transport, ["stdio", "http"] as const, "stdio"),
    command: optStr(s.command, `${field}.command`),
    args: s.args == null ? undefined : asStringArray(s.args, `${field}.args`, MAX_ITEMS),
    url: optStr(s.url, `${field}.url`),
    env: stringMap(s.env, `${field}.env`),
    enabled: s.enabled === true,
  };
}

function agent(raw: unknown, field: string, gapId: string): Agent {
  const a = asRecord(raw, field);
  const now = Date.now();
  return {
    id: str(a.id, `${field}.id`),
    gapId,
    name: asString(a.name, `${field}.name`, { max: 200 }),
    role: str(a.role, `${field}.role`, "", 400),
    emoji: str(a.emoji, `${field}.emoji`, "🤖", 16),
    systemPrompt: str(a.systemPrompt, `${field}.systemPrompt`, "You are a helpful assistant."),
    model: knownModel(a.model),
    runtime: a.runtime === "api" || a.runtime === "claude-code" ? a.runtime : undefined,
    reviewMemory: a.reviewMemory === true ? true : undefined,
    temperature: num(a.temperature, 0.7, 0, 1),
    maxTokens: Math.round(num(a.maxTokens, 2048, 1, 128_000)),
    status: a.status === "paused" ? "paused" : "active",
    skills: list(a.skills, `${field}.skills`, skill),
    knowledge: list(a.knowledge, `${field}.knowledge`, knowledgeDoc),
    connectors: list(a.connectors, `${field}.connectors`, connector),
    channels: list(a.channels, `${field}.channels`, channel),
    createdAt: num(a.createdAt, now, 0),
    updatedAt: num(a.updatedAt, now, 0),
  };
}

/** Validate a pack from outside and fill every field the app reads. Throws InvalidPayload. */
export function normalizeGap(raw: unknown, opts: { allowNoAgents?: boolean } = {}): Gap {
  const field = "gap";
  const g = asRecord(raw, field);
  const id = str(g.id, `${field}.id`);
  const name = asString(g.name, `${field}.name`, { max: 200 });
  if (!Array.isArray(g.agents)) throw new InvalidPayload(`${field}.agents must be an array.`);
  if (g.agents.length === 0 && !opts.allowNoAgents) {
    throw new InvalidPayload(`${field}.agents is empty — at least one agent is required.`);
  }
  const now = Date.now();
  return {
    id,
    slug: str(g.slug, `${field}.slug`, slugify(name) || "pack", 200),
    name,
    description: str(g.description, `${field}.description`),
    emoji: str(g.emoji, `${field}.emoji`, "📦", 16),
    author: str(g.author, `${field}.author`, "", 200),
    version: str(g.version, `${field}.version`, "1.0.0", 50),
    tags: asStringArray(g.tags, `${field}.tags`),
    color: str(g.color, `${field}.color`, "#D9703A", 50),
    source: oneOf(g.source, ["local", "marketplace", "imported"] as const, "imported"),
    installed: g.installed !== false,
    agents: list(g.agents, `${field}.agents`, (a, f) => agent(a, f, id), MAX_AGENTS),
    knowledge: g.knowledge == null ? undefined : list(g.knowledge, `${field}.knowledge`, knowledgeDoc),
    channels: g.channels == null ? undefined : list(g.channels, `${field}.channels`, channel),
    mcpServers: g.mcpServers == null ? undefined : list(g.mcpServers, `${field}.mcpServers`, mcpServer),
    env: stringMap(g.env, `${field}.env`),
    createdAt: num(g.createdAt, now, 0),
    updatedAt: num(g.updatedAt, now, 0),
  };
}
