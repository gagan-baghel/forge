import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { ChatMessage, Conversation } from "@/types/domain";

interface ConversationStore {
  conversations: Conversation[];
  /** Get (or lazily create) the active conversation id for an agent. */
  ensureConversation: (agentId: string) => string;
  newConversation: (agentId: string) => string;
  listForAgent: (agentId: string) => Conversation[];
  get: (id: string) => Conversation | undefined;
  appendMessage: (convId: string, msg: ChatMessage) => void;
  updateMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  setSessionId: (convId: string, ccSessionId: string) => void;
  rename: (convId: string, title: string) => void;
  remove: (convId: string) => void;
}

export const useConversations = create<ConversationStore>()(
  persist(
    (set, get) => ({
      conversations: [],

      ensureConversation: (agentId) => {
        const existing = get().conversations.find((c) => c.agentId === agentId);
        if (existing) return existing.id;
        return get().newConversation(agentId);
      },

      newConversation: (agentId) => {
        const id = nanoid(10);
        const conv: Conversation = {
          id,
          agentId,
          title: "New chat",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ conversations: [conv, ...s.conversations] }));
        return id;
      },

      listForAgent: (agentId) =>
        get()
          .conversations.filter((c) => c.agentId === agentId)
          .sort((a, b) => b.updatedAt - a.updatedAt),

      get: (id) => get().conversations.find((c) => c.id === id),

      appendMessage: (convId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [...c.messages, msg],
                  // First user message becomes the title.
                  title:
                    c.messages.length === 0 && msg.role === "user"
                      ? msg.content.slice(0, 48)
                      : c.title,
                  updatedAt: Date.now(),
                }
              : c,
          ),
        })),

      updateMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                  updatedAt: Date.now(),
                }
              : c,
          ),
        })),

      setSessionId: (convId, ccSessionId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === convId ? { ...c, ccSessionId } : c)),
        })),

      rename: (convId, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === convId ? { ...c, title } : c)),
        })),

      remove: (convId) =>
        set((s) => ({ conversations: s.conversations.filter((c) => c.id !== convId) })),
    }),
    { name: "forge.conversations" },
  ),
);
