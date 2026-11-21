/**
 * The single place an agent run is recorded.
 *
 * Chat, channels and schedules each used to open a run, shape a success
 * patch, and shape an error patch themselves — three copies of the same
 * bookkeeping. That is not just repetition: two of the three forgot to record
 * `model` and `runtime`, so the spend-by-model chart silently covered chat
 * runs only. Anything every run must carry belongs here, once, where no caller
 * can omit it.
 *
 * Callers keep what is genuinely theirs: how to invoke the agent, and how to
 * summarise the result for the log.
 */

import type { Agent, Run } from "@/types/domain";
import type { AgentTurnResult } from "./agentRun";
import { useRuns } from "@/stores/runs";
import { useSettings } from "@/stores/settings";
import { classifyError, errorMessage, isAbortError } from "./runError";
import { logger } from "./log";

const log = logger("runs");

export interface RunOptions {
  /** One-line log summary. Defaults to the head of the reply. */
  summary?: (result: AgentTurnResult) => string;
  /** The pack-chat message this run belongs to; see Run.group. */
  group?: string;
}

/**
 * Record a run around `invoke`. Resolves with the result, or re-throws after
 * recording the failure so callers can still do their own error UI.
 */
export async function recordRun(
  agent: Agent,
  trigger: Run["trigger"],
  invoke: () => Promise<AgentTurnResult>,
  opts: RunOptions = {},
): Promise<AgentTurnResult> {
  const runs = useRuns.getState();
  const runId = runs.startRun({
    gapId: agent.gapId,
    agentId: agent.id,
    agentName: agent.name,
    trigger,
    // Recorded here so no call site can forget them.
    model: agent.model,
    runtime: agent.runtime ?? useSettings.getState().runtime,
    ...(opts.group ? { group: opts.group } : {}),
  });

  const startedAt = Date.now();
  // runId is the correlation id: every entry for this run carries it.
  const ctx = { runId, agentId: agent.id, trigger, model: agent.model };
  log.info("run started", ctx);
  try {
    const result = await invoke();
    log.info("run finished", {
      ...ctx,
      ms: Date.now() - startedAt,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
    });
    runs.finishRun(runId, {
      status: "success",
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      costUsd: result.costUsd,
      summary: (opts.summary ?? ((r) => r.text.slice(0, 80)))(result),
    });
    return result;
  } catch (err) {
    // A user cancel is not a failure; it gets its own status and no error kind.
    const cancelled = isAbortError(err);
    if (cancelled) log.info("run cancelled", { ...ctx, ms: Date.now() - startedAt });
    else log.error("run failed", { ...ctx, ms: Date.now() - startedAt, kind: classifyError(err), error: err });
    runs.finishRun(runId, {
      status: cancelled ? "cancelled" : "error",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      errorKind: cancelled ? undefined : classifyError(err),
      summary: cancelled ? "Cancelled" : errorMessage(err).slice(0, 80),
    });
    throw err;
  }
}
