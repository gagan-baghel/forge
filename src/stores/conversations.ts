import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deferredStorage } from "@/lib/persistStorage";
import { nanoid } from "nanoid";
import type { ChatMessage, Conversation, ConversationOrigin } from "@/types/domain";

interface ConversationStore {
  conversations: Conversation[];
  /** Get (or lazily create) the active conversation id for an agent. */
  ensureConversation: (agentId: string) => string;
  newConversation: (agentId: string, origin?: ConversationOrigin, gapId?: string) => string;
  /** The live thread for a phone chat: its latest conversation, or a new one. */
  conversationFor: (agentId: string, origin: ConversationOrigin) => string;
  listForAgent: (agentId: string) => Conversation[];
  /** A pack's live thread for a phone chat: its latest conversation, or a new one. */
  packConversationFor: (gapId: string, origin: ConversationOrigin) => string;
  /** Pack chats: the latest desk chat with a pack, or a new one. */
  ensurePackConversation: (gapId: string) => string;
  newPackConversation: (gapId: string) => string;
  /** Remember an agent's Claude Code session inside a pack chat. */
  setAgentSession: (convId: string, agentId: string, ccSessionId: string) => void;
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

      ensurePackConversation: (gapId) =>
        get().conversations.find((c) => c.gapId === gapId && !c.origin)?.id ?? get().newPackConversation(gapId),

      newPackConversation: (gapId) => get().newConversation("", undefined, gapId),

      packConversationFor: (gapId, origin) => {
        const latest = get()
          .conversations.filter((c) => c.gapId === gapId && c.origin?.key === origin.key)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return latest?.id ?? get().newConversation("", origin, gapId);
      },

      setAgentSession: (convId, agentId, ccSessionId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, ccSessions: { ...c.ccSessions, [agentId]: ccSessionId } } : c,
          ),
        })),

      newConversation: (agentId, origin, gapId) => {
        const id = nanoid(10);
        const conv: Conversation = {
          id,
          agentId,
          ...(gapId ? { gapId } : {}),
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
                  title: c.messages.length === 0 && msg.role === "user" ? msg.content.slice(0, 48) : c.title,
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

      remove: (convId) => set((s) => ({ conversations: s.conversations.filter((c) => c.id !== convId) })),
    }),
    {
      name: "forge.conversations",
      storage: deferredStorage(),
      // A reply still "pending" when Forge last quit will never finish: say so,
      // instead of a status line (and a thinking bot) that runs forever.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.conversations = state.conversations.map((c) =>
          c.messages.some((m) => m.pending)
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.pending
                    ? { ...m, pending: false, error: m.error ?? "Interrupted — Forge closed before this finished." }
                    : m,
                ),
              }
            : c,
        );
      },
    },
  ),
);
