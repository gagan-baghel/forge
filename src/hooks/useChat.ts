import { useCallback, useRef, useState } from "react";
import type { Agent } from "@/types/domain";
import { runConversationTurn } from "@/lib/conversationTurn";

/**
 * Drives the in-app chat for one conversation: the React state (streaming,
 * stop) around the shared turn engine in `lib/conversationTurn.ts`.
 */
export function useChat(agent: Agent, conversationId: string) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await runConversationTurn(agent, conversationId, trimmed, { trigger: "chat", signal: controller.signal });
      } catch {
        // The turn engine recorded the failure on the message and the run.
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
