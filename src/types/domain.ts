/**
 * Forge domain model.
 *
 * The central concept is the **GAP — Global Agent Pack**: a self-contained,
 * shareable bundle of one or more agents together with the skills, knowledge,
 * connectors and configuration they need to run. A GAP is the unit you build,
 * install from the Marketplace, run, and publish.
 *
 * Everything here is plain serializable data — it persists locally (browser
 * storage on web, the Tauri store / filesystem on desktop) and round-trips to
 * a `.gap` file (a JSON document) for sharing.
 */

import type { ErrorKind } from "@/lib/runError";

export type ID = string;

/** Supported Claude models. Defaults to the latest, most capable Opus. */
export type ModelId =
  | "claude-fable-5"
  | "claude-opus-5"
  | "claude-sonnet-5"
  | "claude-haiku-4-5";

/**
 * Everything the app needs to know about a model, in one place.
 *
 * These facts used to live in four separate collections — a catalogue here, a
 * price table in `claude.ts`, and capability sets in `aiConfig.ts` — all keyed
 * by the same ids. Adding a model meant remembering all four, and forgetting
 * one is how `temperature` kept being sent to models that reject it with a
 * 400. One row per model, and the type system makes an incomplete row a
 * compile error.
 *
 * Prices are USD per million tokens, per Anthropic list pricing.
 */
export interface ModelSpec {
  id: ModelId;
  label: string;
  blurb: string;
  price: { in: number; out: number };
  /** Claude 4.7+ reject temperature/top_p/top_k with a 400. */
  sampling: boolean;
  /** Adaptive thinking + output_config.effort. Replaces the removed budget_tokens. */
  adaptiveThinking: boolean;
  /** Server-side web search tool version this model accepts. */
  webSearch: "web_search_20260209" | "web_search_20250305";
}

export const MODEL_SPECS: Record<ModelId, ModelSpec> = {
  "claude-opus-5": {
    id: "claude-opus-5",
    label: "Opus 5",
    blurb: "Most capable — deep reasoning & agentic work",
    price: { in: 5, out: 25 },
    sampling: false,
    adaptiveThinking: true,
    webSearch: "web_search_20260209",
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    blurb: "Balanced speed and quality",
    price: { in: 2, out: 10 },
    sampling: false,
    adaptiveThinking: true,
    webSearch: "web_search_20260209",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    blurb: "Fastest, lightest, cheapest",
    price: { in: 1, out: 5 },
    // Predates the 4.7 sampling removal, so it still honours temperature.
    sampling: true,
    adaptiveThinking: false,
    webSearch: "web_search_20250305",
  },
  "claude-fable-5": {
    id: "claude-fable-5",
    label: "Fable 5",
    blurb: "Hardest, long-horizon work — needs usage credits",
    price: { in: 10, out: 50 },
    sampling: false,
    adaptiveThinking: true,
    webSearch: "web_search_20260209",
  },
};

/** Display order for pickers. Derived, so it can never drift from the specs. */
export const MODELS: ModelSpec[] = [
  MODEL_SPECS["claude-opus-5"],
  MODEL_SPECS["claude-sonnet-5"],
  MODEL_SPECS["claude-haiku-4-5"],
  MODEL_SPECS["claude-fable-5"],
];

/** Spec for a possibly-unknown id (a stale persisted model, say). */
export function modelSpec(id: string): ModelSpec | undefined {
  return MODEL_SPECS[id as ModelId];
}

/**
 * Model ids that shipped in earlier builds, mapped to their replacement.
 * Persisted agents, brains and settings still carry the old strings, and a
 * stale id silently prices every run at $0 and leaves the model picker blank —
 * so each store migrates through this on rehydrate.
 */
export const MODEL_RENAMES: Record<string, ModelId> = {
  "claude-opus-4-8": "claude-opus-5",
  "claude-sonnet-4-6": "claude-sonnet-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/** Current id for a possibly-stale stored model id. */
export function currentModel<T extends string | undefined>(id: T): T | ModelId {
  return id && MODEL_RENAMES[id] ? MODEL_RENAMES[id] : id;
}

export type AgentStatus = "draft" | "ready" | "live" | "paused";

/**
 * How an agent's turns are executed:
 *  - "api"         — direct BYOK calls to the Claude API (metered).
 *  - "claude-code" — the local Claude Code CLI, on your subscription (nothing metered).
 */
export type RuntimeKind = "api" | "claude-code";

/** A skill is a named capability the agent can invoke (a tool). */
export interface Skill {
  id: ID;
  name: string;
  description: string;
  /** Built-in handler key, or "custom" for prompt-only skills. */
  kind: "web_search" | "code" | "files" | "http" | "memory" | "computer" | "custom";
  enabled: boolean;
}

/** A knowledge document attached to an agent for retrieval. */
export interface KnowledgeDoc {
  id: ID;
  title: string;
  /** Raw text content; chunked + matched at query time for lightweight RAG. */
  content: string;
  source?: string;
  bytes: number;
  addedAt: number;
}

/** An external connector (OAuth / API integration). */
export interface Connector {
  id: ID;
  provider: "slack" | "github" | "gmail" | "notion" | "linear" | "google_drive" | "custom";
  label: string;
  status: "connected" | "disconnected";
  scopes?: string[];
}

/**
 * An MCP server a GAP mounts for its agents. On the Claude Code runtime the
 * config is handed to the CLI (`--mcp-config`), which spawns/connects and
 * exposes the server's tools to every agent in the pack.
 */
export interface McpServer {
  id: ID;
  name: string;
  transport: "stdio" | "http";
  /** stdio: executable + args, spawned locally. */
  command?: string;
  args?: string[];
  /** http: remote MCP endpoint. */
  url?: string;
  /** Extra environment for the spawned server (stdio only). */
  env?: Record<string, string>;
  enabled: boolean;
}

/** A messaging channel that fronts an agent (Telegram, Discord, …). */
export interface Channel {
  id: ID;
  kind: "telegram" | "discord" | "slack" | "web";
  label: string;
  status: "active" | "inactive";
  /** Provider token; stored locally only. */
  token?: string;
  config?: Record<string, string>;
}

/**
 * A Brain is a detachable "mind" — a bundle of persona, model preferences,
 * knowledge and (optionally shared) memory that lives independently of any
 * agent. Attach one brain to any number of agents; detach and re-attach
 * freely. Agent settings stay intact — the brain layers on top.
 */
export interface Brain {
  id: ID;
  name: string;
  emoji: string;
  description: string;
  version: string;
  tags: string[];
  /** Optional overrides. When set they take precedence over the agent's own config. */
  model?: ModelId;
  temperature?: number;
  maxTokens?: number;
  /** Appended to the system prompt of every agent this brain is attached to. */
  systemAppend: string;
  /** Knowledge the brain carries with it; merged into retrieval wherever attached. */
  knowledge: KnowledgeDoc[];
  /**
   * When true, all agents wearing this brain share one long-term memory pool
   * (the `remember`/`recall` skills read and write the brain's memory instead
   * of the agent's own).
   */
  sharedMemory: boolean;
  /**
   * Learning queue: when true, facts agents try to remember are held as
   * pending until you approve them in the brain's Learning list. Rejected
   * facts are dropped; only approved ones are recalled.
   */
  reviewLearning?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Agent {
  id: ID;
  gapId: ID;
  name: string;
  /** One-line role, e.g. "Research assistant". */
  role: string;
  emoji: string;
  systemPrompt: string;
  model: ModelId;
  /** Per-agent runtime override; falls back to the global default when unset. */
  runtime?: RuntimeKind;
  /** Attached Brain (detachable; see `Brain`). Unset = the agent's own config only. */
  brainId?: ID;
  temperature: number;
  maxTokens: number;
  status: AgentStatus;
  skills: Skill[];
  knowledge: KnowledgeDoc[];
  connectors: Connector[];
  channels: Channel[];
  createdAt: number;
  updatedAt: number;
}

export type GapSource = "local" | "marketplace" | "imported";

export interface Gap {
  id: ID;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  author: string;
  version: string;
  tags: string[];
  color: string;
  source: GapSource;
  installed: boolean;
  agents: Agent[];
  /** MCP servers mounted for this pack's agents (Claude Code runtime). */
  mcpServers?: McpServer[];
  /** Environment variables injected into pack runs and MCP servers. */
  env?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** A marketplace listing (a publishable GAP plus discovery metadata). */
export interface MarketplaceListing {
  gap: Omit<Gap, "installed" | "source">;
  featured: boolean;
  installs: number;
  rating: number;
  category: string;
}

/* ----------------------------- Chat ----------------------------------- */

export type Role = "user" | "assistant" | "system";

export interface ToolCall {
  id: ID;
  name: string;
  input?: unknown;
  output?: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: ID;
  role: Role;
  content: string;
  createdAt: number;
  /** Token + cost accounting, populated for assistant turns. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Tool invocations made while producing an assistant turn. */
  toolCalls?: ToolCall[];
  /** Streaming flag for the in-flight assistant message. */
  pending?: boolean;
  error?: string;
}

export interface Conversation {
  id: ID;
  agentId: ID;
  title: string;
  messages: ChatMessage[];
  /** Claude Code session id, set after the first CLI turn so we can --resume. */
  ccSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

/* ----------------------------- Runs ----------------------------------- */

export type RunStatus = "running" | "success" | "error" | "cancelled";

export interface Run {
  id: ID;
  gapId: ID;
  agentId: ID;
  agentName: string;
  status: RunStatus;
  trigger: "chat" | "channel" | "schedule" | "manual";
  startedAt: number;
  endedAt?: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Which model and runtime actually served this run. */
  model?: ModelId;
  runtime?: RuntimeKind;
  /** Set on failures, so the error mix is countable rather than free text. */
  errorKind?: ErrorKind;
  summary?: string;
}

/* ----------------------------- Schedules ------------------------------ */

export interface Routine {
  id: ID;
  agentId: ID;
  agentName: string;
  name: string;
  /** Human cron expression. */
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

/* ----------------------------- Settings ------------------------------- */

export type ThemeName = "dusk" | "paper";

export interface Settings {
  apiKey: string;
  /**
   * Long-lived Claude Code OAuth token from the in-app sign-in
   * (`claude setup-token`). Injected as CLAUDE_CODE_OAUTH_TOKEN on every CLI
   * run so the app works even when the CLI's own keychain session is stale.
   * Stored locally only.
   */
  ccToken: string;
  defaultModel: ModelId;
  /** Default runtime for agents that don't override it. */
  runtime: RuntimeKind;
  theme: ThemeName;
  userName: string;
  onboarded: boolean;
  /** Price overrides per model, USD per million tokens [in, out]. */
  priceOverrides: Record<string, { in: number; out: number }>;
}
