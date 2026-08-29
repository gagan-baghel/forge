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
import { classifyError } from "./runError";

export interface RunOptions {
  /** One-line log summary. Defaults to the head of the reply. */
  summary?: (result: AgentTurnResult) => string;
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
  });

  try {
    const result = await invoke();
    runs.finishRun(runId, {
      status: "success",
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      costUsd: result.costUsd,
      summary: (opts.summary ?? ((r) => r.text.slice(0, 80)))(result),
    });
    return result;
  } catch (err: any) {
    // A user cancel is not a failure; it gets its own status and no error kind.
    const cancelled = err?.name === "AbortError";
    runs.finishRun(runId, {
      status: cancelled ? "cancelled" : "error",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      errorKind: cancelled ? undefined : classifyError(err),
      summary: cancelled ? "Cancelled" : String(err?.message ?? err).slice(0, 80),
    });
    throw err;
  }
}
