import { useCallback, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { Agent, ChatMessage } from "@/types/domain";
import { useConversations } from "@/stores/conversations";
import { runAgentTurn } from "@/lib/agentRun";
import { recordRun } from "@/lib/runner";

/**
 * Drives a single agent conversation: appends the user + assistant messages,
 * runs the agent (tool-use loop or Claude Code), streams text into the store,
 * and records a run with token/cost accounting.
 */
export function useChat(agent: Agent, conversationId: string) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const convStore = useConversations.getState();

      const userMsg: ChatMessage = { id: nanoid(8), role: "user", content: trimmed, createdAt: Date.now() };
      convStore.appendMessage(conversationId, userMsg);

      const assistantId = nanoid(8);
      convStore.appendMessage(conversationId, {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      });

      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const conv = convStore.get(conversationId);
      const history = conv?.messages.filter((m) => m.id !== assistantId) ?? [];

      const appendDelta = (delta: string) => {
        const current = convStore.get(conversationId)?.messages.find((m) => m.id === assistantId);
        convStore.updateMessage(conversationId, assistantId, { content: (current?.content ?? "") + delta });
      };

      const upsertTool = (ev: { id: string; name: string; input?: unknown; output?: string; status: "running" | "done" | "error" }) => {
        const current = convStore.get(conversationId)?.messages.find((m) => m.id === assistantId);
        const calls = [...(current?.toolCalls ?? [])];
        const idx = calls.findIndex((c) => c.id === ev.id);
        if (idx >= 0) calls[idx] = { ...calls[idx], ...ev };
        else calls.push(ev);
        convStore.updateMessage(conversationId, assistantId, { toolCalls: calls });
      };

      try {
        const result = await recordRun(agent, "chat", () =>
          runAgentTurn(agent, history, {
            onText: appendDelta,
            onTool: upsertTool,
            signal: controller.signal,
            resumeSessionId: conv?.ccSessionId,
          }),
        );

        if (result.sessionId) convStore.setSessionId(conversationId, result.sessionId);
        // For the CLI runtime the final text replaces the streamed buffer.
        const current = convStore.get(conversationId)?.messages.find((m) => m.id === assistantId);
        if (!current?.content && result.text) {
          convStore.updateMessage(conversationId, assistantId, { content: result.text });
        }

        convStore.updateMessage(conversationId, assistantId, {
          pending: false,
          usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
        });
      } catch (err: any) {
        const cancelled = err?.name === "AbortError";
        convStore.updateMessage(conversationId, assistantId, {
          pending: false,
          error: cancelled ? "Stopped." : String(err?.message ?? err),
        });
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [agent, conversationId, streaming],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { send, stop, streaming };
}
