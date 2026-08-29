import { modelSpec } from "@/types/domain";

/**
 * Central AI configuration.
 *
 * These knobs were duplicated across stores, seeds and views, so tuning one
 * meant grepping for a literal and hoping. Everything that shapes a model call
 * — sampling, output ceiling, how much history is resent — lives here.
 */

/** Sampling defaults for a new agent. */
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 2048;

/**
 * Rough characters-per-token. Used only to budget how much history to resend;
 * a real tokenizer would cost a round-trip per turn to buy precision that
 * a conservative estimate already provides.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * How much prior conversation to resend per turn. The full transcript grows
 * without bound and is re-billed every turn; this caps that.
 */
export const HISTORY_TOKEN_BUDGET = 30_000;

/* --------------------- Per-model capability lookups --------------------- */
/* All of these read `MODEL_SPECS`, the single source of truth in domain.ts.
   Unknown ids (a stale persisted model) get the conservative answer: send
   nothing optional, so an unrecognised model can never 400 on a parameter. */

/** Claude 4.7+ reject temperature/top_p/top_k with a 400. */
export function supportsSampling(model: string): boolean {
  return modelSpec(model)?.sampling ?? false;
}

/** Adaptive thinking + effort; `budget_tokens` is removed on these models. */
export function supportsAdaptiveThinking(model: string): boolean {
  return modelSpec(model)?.adaptiveThinking ?? false;
}

/** Server-side web search tool version this model accepts. */
export function webSearchToolType(model: string): string {
  return modelSpec(model)?.webSearch ?? "web_search_20250305";
}

/** Thinking depth and overall token spend. `high` is the API default. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_EFFORT: Effort = "high";

/**
 * A cheap model for mechanical work — titles, classification, short rewrites —
 * so simple calls don't pay Opus rates. Reasoning stays on the agent's own
 * model: the user picked it, and quietly downgrading their agent is not ours
 * to decide.
 */
export const UTILITY_MODEL = "claude-haiku-4-5";

export function routeModel(kind: "utility" | "reasoning", agentModel: string): string {
  return kind === "utility" ? UTILITY_MODEL : agentModel;
}
