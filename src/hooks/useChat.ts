import { useCallback, useRef, useState } from "react";
import type { Agent, Gap } from "@/types/domain";
import { runConversationTurn } from "@/lib/conversationTurn";
import { runPackTurn } from "@/lib/pack";

/** Who the chat is with: one agent, or a whole pack. */
export type ChatTarget = { agent: Agent; gap?: undefined } | { gap: Gap; agent?: undefined };

/**
 * Drives the in-app chat for one conversation: the React state (streaming,
 * stop) around the shared turn engine in `lib/conversationTurn.ts`.
 */
export function useChat(target: ChatTarget, conversationId: string) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { agent, gap } = target;

  const send = useCallback(
    /** `into` overrides the conversation: the chat creates its first one on the first send. */
    async (text: string, into = conversationId) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const opts = { trigger: "chat" as const, signal: controller.signal };
      try {
        if (gap) await runPackTurn(gap, into, trimmed, opts);
        else await runConversationTurn(agent, into, trimmed, opts);
      } catch {
        // The turn engine recorded the failure on the message and the run.
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [agent, gap, conversationId, streaming],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { send, stop, streaming };
}
