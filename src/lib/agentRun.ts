/**
 * Agent run engine. One entry point — `runAgentTurn` — drives a single agent
 * response end to end, used by interactive chat, live channels, and scheduled
 * routines alike.
 *
 * For the API runtime it runs a full tool-use loop: stream a turn, execute any
 * requested tools, feed the results back, and repeat until the model stops.
 * For the Claude Code runtime it delegates to the local CLI (which carries its
 * own tools and session memory).
 */

import type { Agent, ChatMessage } from "@/types/domain";
import { streamMessage, type ApiContent, type ApiMessage } from "./claude";
import { streamClaudeCode } from "./claudeCode";
import { buildTools, runTool } from "./tools";
import { retrieveAsync } from "./knowledge";
import { useSettings } from "@/stores/settings";
import { useGaps } from "@/stores/gaps";
import { brainFor } from "@/stores/brains";
import { buildMcpConfig } from "./mcp";

export interface ToolEvent {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  status: "running" | "done" | "error";
}

export interface AgentTurnOpts {
  onText: (delta: string) => void;
  onActivity?: (label: string) => void;
  /** Structured tool lifecycle: fired when a tool starts and when it finishes. */
  onTool?: (event: ToolEvent) => void;
  signal?: AbortSignal;
  /** Claude Code session to resume (CLI runtime only). */
  resumeSessionId?: string;
  /** Hard cap on tool-use iterations to avoid runaway loops. */
  maxSteps?: number;
}

export interface AgentTurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** New Claude Code session id (CLI runtime only). */
  sessionId?: string;
}

function toApiMessages(history: ChatMessage[]): ApiMessage[] {
  return history
    .filter((m) => m.role !== "system" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

/** Run one agent turn. `history` ends with the latest user message. */
export async function runAgentTurn(
  agent: Agent,
  history: ChatMessage[],
  opts: AgentTurnOpts,
): Promise<AgentTurnResult> {
  const settings = useSettings.getState();
  const runtime = agent.runtime ?? settings.runtime;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "";

  // Attached brain (if any) layers on top of the agent's own config: its
  // model/sampling overrides win, its prompt is appended, its knowledge joins
  // the retrieval pool.
  const brain = brainFor(agent);
  const model = brain?.model ?? agent.model;
  const temperature = brain?.temperature ?? agent.temperature;
  const maxTokens = brain?.maxTokens ?? agent.maxTokens;

  // System prompt = identity (+ brain persona) + semantically-retrieved knowledge.
  const knowledge = await retrieveAsync([...agent.knowledge, ...(brain?.knowledge ?? [])], userText);
  const system = [
    agent.systemPrompt,
    brain?.systemAppend ? `\n\n${brain.systemAppend}` : "",
    knowledge ? `\n\nRelevant knowledge (cite when used):\n${knowledge}` : "",
  ].join("");

  if (runtime === "claude-code") {
    // The pack's MCP servers and environment ride along on every CLI turn.
    const gap = useGaps.getState().findGap(agent.gapId);
    const result = await streamClaudeCode(
      {
        model,
        system,
        prompt: userText,
        resume: opts.resumeSessionId ?? "",
        mcpConfig: gap ? buildMcpConfig(gap) : undefined,
        env: gap?.env && Object.keys(gap.env).length > 0 ? gap.env : undefined,
      },
      { signal: opts.signal, onText: opts.onText },
    );
    return {
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      sessionId: result.sessionId,
    };
  }

  // API runtime: agentic tool-use loop.
  const { defs, executors } = buildTools(agent);
  const messages = toApiMessages(history);
  const maxSteps = opts.maxSteps ?? 6;

  let totalIn = 0;
  let totalOut = 0;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    const turn = await streamMessage(
      {
        apiKey: settings.apiKey,
        model,
        system,
        messages,
        temperature,
        maxTokens,
        tools: defs,
      },
      { signal: opts.signal, onText: opts.onText },
    );

    totalIn += turn.inputTokens;
    totalOut += turn.outputTokens;
    if (turn.text) finalText = turn.text;

    // Only client tool_use blocks require a loop; server tools resolve inline.
    const clientToolUses = turn.toolUses.filter((t) => executors[t.name]);
    if (turn.stopReason !== "tool_use" || clientToolUses.length === 0) {
      break;
    }

    // Record the assistant's tool-call turn, then run tools and feed results.
    messages.push({ role: "assistant", content: turn.content });
    const results: ApiContent[] = [];
    for (const tu of clientToolUses) {
      opts.onTool?.({ id: tu.id, name: tu.name, input: tu.input, status: "running" });
      const out = await runTool(tu.name, tu.input, executors, { agent, onActivity: opts.onActivity });
      opts.onTool?.({ id: tu.id, name: tu.name, input: tu.input, output: out, status: out.startsWith("Error") ? "error" : "done" });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: finalText, inputTokens: totalIn, outputTokens: totalOut };
}

/** Headless single-shot run (channels, schedules): a fresh conversation. */
export async function runAgentHeadless(
  agent: Agent,
  userText: string,
  opts?: { onText?: (d: string) => void; signal?: AbortSignal },
): Promise<AgentTurnResult> {
  const history: ChatMessage[] = [
    { id: "u", role: "user", content: userText, createdAt: Date.now() },
  ];
  return runAgentTurn(agent, history, {
    onText: opts?.onText ?? (() => {}),
    signal: opts?.signal,
  });
}
