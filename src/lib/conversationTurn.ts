/**
 * One conversation turn, end to end: append the user message and a pending
 * assistant message, run the agent (streaming text and tool activity into the
 * store), record the run, and settle the assistant message.
 *
 * The in-app chat and remote channels both go through here, so a conversation
 * held from a phone is the same kind of thing as one held at the desk — it
 * shows up in the agent's chat list, live, and can be continued from either.
 */

import { nanoid } from "nanoid";
import type { Agent, ChatMessage, Run } from "@/types/domain";
import { useConversations } from "@/stores/conversations";
import { runAgentTurn, type AgentTurnResult, type ToolEvent } from "./agentRun";
import { recordRun } from "./runner";
import type { ChannelRef } from "./approval";

export interface ConversationTurnOpts {
  trigger: Run["trigger"];
  signal?: AbortSignal;
  channel?: ChannelRef;
  headless?: boolean;
  onTool?: (event: ToolEvent) => void;
  /** Log line for the run. Defaults to the head of the reply. */
  summary?: (result: AgentTurnResult) => string;
}

export async function runConversationTurn(
  agent: Agent,
  conversationId: string,
  text: string,
  opts: ConversationTurnOpts,
): Promise<AgentTurnResult> {
  const convs = useConversations.getState();

  const userMsg: ChatMessage = { id: nanoid(8), role: "user", content: text, createdAt: Date.now() };
  convs.appendMessage(conversationId, userMsg);

  const assistantId = nanoid(8);
  convs.appendMessage(conversationId, {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    pending: true,
  });

  const conv = convs.get(conversationId);
  const history = conv?.messages.filter((m) => m.id !== assistantId) ?? [];
  const current = () => useConversations.getState().get(conversationId)?.messages.find((m) => m.id === assistantId);
  const patch = (p: Partial<ChatMessage>) => useConversations.getState().updateMessage(conversationId, assistantId, p);

  const onText = (delta: string) => patch({ content: (current()?.content ?? "") + delta });
  const onTool = (ev: ToolEvent) => {
    const calls = [...(current()?.toolCalls ?? [])];
    const idx = calls.findIndex((c) => c.id === ev.id);
    // A result event carries no input; don't let its undefined fields wipe
    // what the start event recorded (the command shown in the chat).
    const defined = Object.fromEntries(Object.entries(ev).filter(([, v]) => v !== undefined && v !== ""));
    if (idx >= 0) calls[idx] = { ...calls[idx], ...defined };
    else calls.push(ev);
    patch({ toolCalls: calls });
    opts.onTool?.(ev);
  };

  try {
    const result = await recordRun(
      agent,
      opts.trigger,
      () =>
        runAgentTurn(agent, history, {
          onText,
          onTool,
          signal: opts.signal,
          resumeSessionId: conv?.ccSessionId,
          channel: opts.channel,
          headless: opts.headless,
        }),
      { summary: opts.summary },
    );

    if (result.sessionId) useConversations.getState().setSessionId(conversationId, result.sessionId);
    // The CLI runtime's final text replaces an empty streamed buffer.
    if (!current()?.content && result.text) patch({ content: result.text });
    patch({
      pending: false,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
    });
    return result;
  } catch (err: any) {
    const cancelled = err?.name === "AbortError";
    patch({ pending: false, error: cancelled ? "Stopped." : String(err?.message ?? err) });
    throw err;
  }
}
