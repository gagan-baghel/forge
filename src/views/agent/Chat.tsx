import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@/types/domain";
import { useChat } from "@/hooks/useChat";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { Markdown } from "@/components/Markdown";
import { Icon } from "@/components/Icon";
import { Button, Spinner } from "@/components/ui";
import { fmtTokens } from "@/lib/format";

export function Chat({ agent }: { agent: Agent }) {
  const ensureConversation = useConversations((s) => s.ensureConversation);
  const newConversation = useConversations((s) => s.newConversation);
  const conversations = useConversations((s) => s.conversations);
  const apiKey = useSettings((s) => s.apiKey);
  const defaultRuntime = useSettings((s) => s.runtime);
  const runtime = agent.runtime ?? defaultRuntime;
  const needsKey = runtime === "api" && !apiKey;

  const [convId, setConvId] = useState(() => ensureConversation(agent.id));
  const conv = useConversations((s) => s.get(convId));
  const agentConvs = useMemo(
    () => conversations.filter((c) => c.agentId === agent.id).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, agent.id],
  );

  const { send, stop, streaming } = useChat(agent, convId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conv?.messages.length, conv?.messages[conv.messages.length - 1]?.content]);

  const submit = () => {
    if (!draft.trim() || streaming) return;
    void send(draft);
    setDraft("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const messages = conv?.messages ?? [];
  const totalTokens = messages.reduce(
    (a, m) => a + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0),
    0,
  );

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="p-3">
          <Button
            variant="outline"
            icon="plus"
            className="w-full"
            onClick={() => setConvId(newConversation(agent.id))}
          >
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {agentConvs.map((c) => (
            <button
              key={c.id}
              onClick={() => setConvId(c.id)}
              className={`mb-0.5 w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                c.id === convId ? "bg-brand/12 text-ink" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              {c.title || "New chat"}
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-md text-center">
              <div className="mb-3 text-4xl">{agent.emoji}</div>
              <h3 className="text-lg font-semibold">{agent.name}</h3>
              <p className="mt-1 text-sm text-ink-2">{agent.role}</p>
              {needsKey && (
                <div className="mt-5 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
                  Add your Claude API key in Settings — or switch this agent to the Claude Code runtime.
                </div>
              )}
              {runtime === "claude-code" && (
                <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs text-success">
                  <Icon name="bolt" size={13} /> Running on Claude Code · your subscription
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex gap-3"}>
                  {m.role === "assistant" && <span className="mt-0.5 text-xl">{agent.emoji}</span>}
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[80%] rounded-2xl rounded-tr-sm bg-brand px-4 py-2.5 text-sm text-white whitespace-pre-wrap"
                        : "max-w-[85%] rounded-2xl rounded-tl-sm bg-surface px-4 py-3 border border-border"
                    }
                  >
                    {m.role === "assistant" ? (
                      <>
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <div className="mb-2 flex flex-col gap-1">
                            {m.toolCalls.map((tc) => (
                              <details key={tc.id} className="rounded-lg border border-border bg-bg/60 text-xs">
                                <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5">
                                  {tc.status === "running" ? <Spinner size={12} /> : (
                                    <Icon name={tc.status === "error" ? "x" : "check"} size={13} className={tc.status === "error" ? "text-danger" : "text-success"} />
                                  )}
                                  <span className="font-mono text-ink-2">{tc.name}</span>
                                </summary>
                                {tc.output && (
                                  <pre className="max-h-48 overflow-auto border-t border-border px-2.5 py-1.5 font-mono text-[0.7rem] text-ink-3 whitespace-pre-wrap">
                                    {tc.output.slice(0, 1500)}
                                  </pre>
                                )}
                              </details>
                            ))}
                          </div>
                        )}
                        {m.content ? <Markdown content={m.content} /> : m.pending && <Spinner size={14} />}
                        {m.error && <div className="mt-1 text-xs text-danger">{m.error}</div>}
                        {m.usage && (
                          <div className="mt-2 flex gap-3 text-[0.68rem] text-ink-3">
                            <span>{fmtTokens(m.usage.inputTokens + m.usage.outputTokens)} tok</span>
                          </div>
                        )}
                      </>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-brand">
              <textarea
                ref={taRef}
                value={draft}
                rows={1}
                placeholder={`Message ${agent.name}…`}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {streaming ? (
                <button className="btn-ghost p-2 text-danger" onClick={stop} title="Stop">
                  <Icon name="stop" size={18} />
                </button>
              ) : (
                <button
                  className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white disabled:opacity-40"
                  onClick={submit}
                  disabled={!draft.trim()}
                  title="Send"
                >
                  <Icon name="send" size={18} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[0.68rem] text-ink-3">
              <span>Enter to send · Shift+Enter for newline</span>
              {totalTokens > 0 && <span>Session: {fmtTokens(totalTokens)} tok</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
