import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { Agent, ToolCall } from "@/types/domain";
import { useChat } from "@/hooks/useChat";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { Markdown } from "@/components/Markdown";
import { Icon } from "@/components/Icon";
import { Avatar, Button, Spinner } from "@/components/ui";
import { fmtUsd, fmtTokens, relativeTime } from "@/lib/format";

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
  const totalCost = messages.reduce((a, m) => a + (m.usage?.costUsd ?? 0), 0);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
        <div className="p-3">
          <Button variant="outline" icon="plus" className="w-full" onClick={() => setConvId(newConversation(agent.id))}>
            New chat
          </Button>
        </div>
        <div className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
          {agentConvs.map((c) => (
            <button
              key={c.id}
              onClick={() => setConvId(c.id)}
              className={clsx(
                "block w-full rounded-md px-2.5 py-1.5 text-left transition-colors",
                c.id === convId ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/50 hover:text-ink",
              )}
            >
              <div className="truncate text-[13px]">{c.title || "New chat"}</div>
              <div className="flex items-center gap-1 truncate text-[11px] text-ink-3">
                {c.origin ? (
                  <>
                    <Icon name="phone" size={11} className="shrink-0" />
                    <span className="truncate">
                      {c.origin.kind === "telegram" ? "Telegram" : "Discord"} · {c.origin.from}
                    </span>
                  </>
                ) : (
                  relativeTime(c.updatedAt)
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Announce streamed replies to screen readers. "polite" so it waits
            for a pause rather than interrupting on every token. */}
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label={`Conversation with ${agent.name}`}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          {messages.length === 0 ? (
            <div className="mx-auto mt-16 flex max-w-sm flex-col items-center text-center">
              <Avatar name={agent.name} size={40} />
              <h3 className="mt-3 text-[15px] font-semibold">{agent.name}</h3>
              <p className="mt-0.5 text-[13px] text-ink-3">{agent.role}</p>
              {conv?.origin && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-3">
                  <Icon name="phone" size={12} /> {conv.origin.kind === "telegram" ? "Telegram" : "Discord"} · {conv.origin.from}
                </p>
              )}
              {needsKey && (
                <div className="mt-5 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                  Add your Claude API key in Settings — or switch this agent to the Claude Code runtime.
                </div>
              )}
              {runtime === "claude-code" && (
                <div className="mt-5 inline-flex items-center gap-1.5 text-xs text-ink-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Running on Claude Code · your subscription
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="anim-rise flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-surface-2 px-3.5 py-2 text-[13px] leading-relaxed text-ink">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="anim-rise flex gap-3">
                    <Avatar name={agent.name} size={24} className="mt-0.5 rounded-md" />
                    <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                      {m.toolCalls && m.toolCalls.length > 0 && (
                        <div className="mb-2 overflow-hidden rounded-md border border-border">
                          {m.toolCalls.map((tc) => (
                            <ToolRow key={tc.id} call={tc} />
                          ))}
                        </div>
                      )}
                      {m.content ? <Markdown content={m.content} /> : m.pending && <Spinner size={14} />}
                      {m.error && <div className="mt-1 text-xs text-danger">{m.error}</div>}
                      {m.usage && (
                        <div className="mt-1.5 flex gap-2 font-mono text-[10px] text-ink-3">
                          <span>{fmtTokens(m.usage.inputTokens + m.usage.outputTokens)} tok</span>
                          {m.usage.costUsd > 0 && <span>{fmtUsd(m.usage.costUsd)}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-6 pb-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-surface p-1.5 transition-colors focus-within:border-border-strong">
              <textarea
                ref={taRef}
                value={draft}
                rows={1}
                placeholder={`Message ${agent.name}…`}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-ink-3"
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
                <button className="btn-outline h-8 w-8 px-0 text-danger" onClick={stop} title="Stop" aria-label="Stop">
                  <Icon name="stop" size={14} />
                </button>
              ) : (
                <button className="btn-primary h-8 w-8 px-0" onClick={submit} disabled={!draft.trim()} title="Send" aria-label="Send">
                  <Icon name="send" size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[11px] text-ink-3">
              <span>
                <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd>+<kbd className="kbd">Enter</kbd> for newline
              </span>
              {totalTokens > 0 && (
                <span className="font-mono">
                  {fmtTokens(totalTokens)} tok{totalCost > 0 && ` · ${fmtUsd(totalCost)}`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A short, human line for what a tool was asked to do (the Bash command, the query, the path…). */
function summarize(input: unknown): string {
  if (input == null) return "";
  if (typeof input !== "object") return String(input);
  const o = input as Record<string, unknown>;
  for (const k of ["command", "query", "url", "file_path", "path", "pattern", "text", "prompt", "name"]) {
    if (typeof o[k] === "string" && o[k]) return o[k] as string;
  }
  const first = Object.values(o).find((v) => typeof v === "string" && v);
  return typeof first === "string" ? first : JSON.stringify(o);
}

function ToolRow({ call }: { call: ToolCall }) {
  // The summary appears once the call settles: while it runs, an approval
  // dialog may be showing the very same command, and one copy is enough.
  const summary = call.status === "running" ? "" : summarize(call.input).replace(/\s+/g, " ");
  const icon =
    call.status === "running" ? (
      <Spinner size={12} />
    ) : (
      <Icon name={call.status === "error" ? "x" : "check"} size={12} className={call.status === "error" ? "text-danger" : "text-success"} />
    );
  const head = (
    <>
      <span className="grid w-3 shrink-0 place-items-center">{icon}</span>
      <span className="shrink-0 font-mono text-ink-2">{call.name}</span>
      {summary && <span className="min-w-0 truncate font-mono text-ink-3">{summary.slice(0, 200)}</span>}
    </>
  );
  if (!call.output) {
    return <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0">{head}</div>;
  }
  return (
    <details className="group border-b border-border text-xs last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
        {head}
        <Icon name="chevron" size={12} className="ml-auto shrink-0 text-ink-3 transition-transform group-open:rotate-90" />
      </summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border bg-bg/60 px-2.5 py-2 font-mono text-[11px] text-ink-3">
        {call.output.slice(0, 1500)}
      </pre>
    </details>
  );
}
