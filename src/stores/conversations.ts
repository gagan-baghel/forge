import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { ChatMessage, Conversation, ConversationOrigin } from "@/types/domain";

interface ConversationStore {
  conversations: Conversation[];
  /** Get (or lazily create) the active conversation id for an agent. */
  ensureConversation: (agentId: string) => string;
  newConversation: (agentId: string, origin?: ConversationOrigin) => string;
  /** The live thread for a phone chat: its latest conversation, or a new one. */
  conversationFor: (agentId: string, origin: ConversationOrigin) => string;
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
        // The in-app chat opens on a desk conversation, not a phone thread.
        const existing = get().conversations.find((c) => c.agentId === agentId && !c.origin);
        if (existing) return existing.id;
        return get().newConversation(agentId);
      },

      newConversation: (agentId, origin) => {
        const id = nanoid(10);
        const conv: Conversation = {
          id,
          agentId,
          ...(origin ? { origin } : {}),
          title: "New chat",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ conversations: [conv, ...s.conversations] }));
        return id;
      },

      conversationFor: (agentId, origin) => {
        const latest = get()
          .conversations.filter((c) => c.agentId === agentId && c.origin?.key === origin.key)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest?.id ?? get().newConversation(agentId, origin);
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
