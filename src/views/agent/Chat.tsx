import { useEffect, useMemo, useRef, useState } from "react";
import { BotFace } from "@/components/BotFace";
import { BotBuddy, type BuddyMood } from "@/components/BotBuddy";
import clsx from "clsx";
import type { Agent, ChatMessage, ToolCall } from "@/types/domain";
import { useChat, type ChatTarget } from "@/hooks/useChat";
import { pickAgent } from "@/lib/pack";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { Markdown } from "@/components/Markdown";
import { Icon } from "@/components/Icon";
import { Button, Spinner } from "@/components/ui";
import { fmtUsd, fmtTokens, relativeTime } from "@/lib/format";
import { describeStep, elapsed } from "@/lib/activity";
import { useNow } from "@/hooks/useNow";

/**
 * The chat thread, with one agent or with a whole pack. In a pack chat each
 * reply carries its author, and the composer shows who will answer next.
 */
export function Chat(target: ChatTarget) {
  const { gap } = target;
  const newConversation = useConversations((s) => s.newConversation);
  const newPackConversation = useConversations((s) => s.newPackConversation);
  const conversations = useConversations((s) => s.conversations);
  const apiKey = useSettings((s) => s.apiKey);
  const defaultRuntime = useSettings((s) => s.runtime);

  const fresh = () => (gap ? newPackConversation(gap.id) : newConversation(target.agent.id));
  // Open on the latest desk chat, without creating one: creating while the
  // screen draws updates the store mid-render, and merely visiting left empty
  // "New chat" entries behind. The first send creates it instead.
  const [convId, setConvId] = useState(
    () =>
      useConversations
        .getState()
        .conversations.filter((c) => !c.origin && (gap ? c.gapId === gap.id : c.agentId === target.agent.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? "",
  );
  const conv = useConversations((s) => s.get(convId));
  const ownerId = gap ? gap.id : target.agent.id;
  const agentConvs = useMemo(
    () =>
      conversations
        .filter((c) => (gap ? c.gapId === ownerId : c.agentId === ownerId))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, ownerId, gap],
  );

  const { send, stop, streaming } = useChat(target, convId);
  const [draft, setDraft] = useState("");
  const messages = conv?.messages ?? [];
  // Who answers the message being typed: the agent itself, or the pack's pick.
  const agent: Agent | undefined = gap ? pickAgent(gap, messages, draft.trim()) : target.agent;
  const author = (m: ChatMessage) => (m.agentId && gap ? gap.agents.find((a) => a.id === m.agentId) : agent);
  const runtime = agent?.runtime ?? defaultRuntime;
  const needsKey = runtime === "api" && !apiKey;
  const title = gap ? gap.name : (agent?.name ?? "");

  // The bots act out what's happening: the one replying thinks, then talks
  // as text streams in; a teammate it's asking thinks too; paused ones sleep.
  const pending = [...messages].reverse().find((m) => m.pending);
  const replying = pending ? (author(pending) ?? agent) : undefined;
  const team = gap ? gap.agents : agent ? [agent] : [];
  const asked = new Set(
    (pending?.toolCalls ?? [])
      .filter((c) => c.name === "ask_teammate" && c.status === "running")
      .map((c) => String((c.input as { teammate?: string } | undefined)?.teammate ?? "").toLowerCase()),
  );
  const moodOf = (a: Agent): BuddyMood => {
    if (replying?.id === a.id) return pending?.content ? "talk" : "think";
    if (asked.has(a.name.toLowerCase())) return "think";
    return a.status === "paused" ? "sleep" : "play";
  };
  // Perched on the message box once the chat has started: whoever is working, else who replies next.
  const perched = [
    replying ?? agent,
    ...team.filter((a) => a.id !== replying?.id && asked.has(a.name.toLowerCase())),
  ].filter((a): a is Agent => !!a);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Follow the newest message as it grows while streaming.
  const lastContent = conv?.messages[conv.messages.length - 1]?.content;
  const messageCount = conv?.messages.length;
  // A new step (a tool, a teammate asked) grows the reply as surely as text does.
  const lastSteps = conv?.messages[conv.messages.length - 1]?.toolCalls?.length;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messageCount, lastContent, lastSteps]);

  // A reply still running in this chat — maybe started before you navigated
  // away and back — must finish first, or two replies interleave in one thread.
  const busy = streaming || !!pending;
  // A pack with no agents has nobody to answer.
  const nobody = !!gap && !agent;
  const submit = () => {
    if (!draft.trim() || busy || nobody) return;
    let into = convId;
    if (!into) {
      into = fresh();
      setConvId(into);
    }
    void send(draft, into);
    setDraft("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const totalTokens = messages.reduce((a, m) => a + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0), 0);
  const totalCost = messages.reduce((a, m) => a + (m.usage?.costUsd ?? 0), 0);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
        <div className="p-3">
          <Button variant="outline" icon="plus" className="w-full" onClick={() => setConvId(fresh())}>
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
          aria-label={`Conversation with ${title}`}
          className={clsx("flex-1 overflow-y-auto px-6 pt-6", messages.length > 0 ? "pb-20" : "pb-6")}
        >
          {messages.length === 0 ? (
            <div className="mx-auto mt-16 flex max-w-sm flex-col items-center text-center">
              <div className="flex items-end justify-center gap-2">
                {team.slice(0, 4).map((a) => (
                  <BotBuddy key={a.id} name={a.name} mood={moodOf(a)} size={gap ? 84 : 120} />
                ))}
              </div>
              <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
              {gap ? (
                <>
                  <ul className="mt-3 space-y-0.5 text-[13px] text-ink-2">
                    {gap.agents.map((a) => (
                      <li key={a.id}>
                        {a.name} <span className="text-ink-3">· {a.role}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink-3">
                    {agent ? `${agent.name} answers first and brings in teammates when needed.` : ""} Start a message
                    with @name to pick who answers.
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-[13px] text-ink-3">{agent?.role}</p>
              )}
              {conv?.origin && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-3">
                  <Icon name="phone" size={12} /> {conv.origin.kind === "telegram" ? "Telegram" : "Discord"} ·{" "}
                  {conv.origin.from}
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
                    <BotFace name={author(m)?.name ?? title} size={26} className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                      {gap && (
                        <div className="mb-0.5 text-xs font-medium text-ink-2">
                          {author(m)?.name ?? "Removed agent"}
                        </div>
                      )}
                      {m.toolCalls && m.toolCalls.length > 0 && (
                        <div className="mb-2 overflow-hidden rounded-md border border-border">
                          {m.toolCalls.map((tc) => (
                            <ToolRow key={tc.id} call={tc} />
                          ))}
                        </div>
                      )}
                      {m.content && <Markdown content={m.content} />}
                      {m.pending && <LiveStatus calls={m.toolCalls} since={m.createdAt} writing={!!m.content} />}
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
          <div className="relative mx-auto max-w-3xl">
            {messages.length > 0 && (
              <div className="pointer-events-none absolute bottom-[calc(100%-6px)] right-3 flex items-end gap-1">
                {perched.map((a) => (
                  <BotBuddy key={a.id} name={a.name} mood={moodOf(a)} size={52} />
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-2 rounded-lg border border-border bg-surface p-1.5 transition-colors focus-within:border-border-strong">
              <textarea
                ref={taRef}
                value={draft}
                rows={1}
                placeholder={
                  nobody
                    ? "Add an agent to this pack first (Pack settings → Agents)"
                    : gap
                      ? `Message ${gap.name}… (@name to pick who replies)`
                      : `Message ${title}…`
                }
                disabled={nobody}
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
                <button
                  className="btn-primary h-8 w-8 px-0"
                  onClick={submit}
                  disabled={!draft.trim() || busy || nobody}
                  title="Send"
                  aria-label="Send"
                >
                  <Icon name="send" size={14} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[11px] text-ink-3">
              <span>
                {gap && agent && <span className="text-ink-2">{agent.name} replies · </span>}
                <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd>+
                <kbd className="kbd">Enter</kbd> for newline
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

/**
 * What a reply is doing right now, in words, with how long it has taken:
 * "Searching the web: history of Greece · 0:12". Replaces a bare spinner,
 * which on a long research run looked exactly like a hang.
 */
function LiveStatus({ calls = [], since, writing }: { calls?: ToolCall[]; since: number; writing: boolean }) {
  const now = useNow(1000);
  const running = [...calls].reverse().find((c) => c.status === "running");
  let label = writing ? "Writing" : calls.length ? "Thinking about what it found" : "Thinking";
  if (running) {
    const step = describeStep(running.name, running.input);
    label = step.showDetailWhileRunning && step.detail ? `${step.active}: ${step.detail}` : step.active;
  }
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-ink-3">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
      <span role="status" aria-live="polite" className="min-w-0 truncate">
        {label}…
      </span>
      <span aria-hidden className="num shrink-0">
        {elapsed(now - since)}
      </span>
    </div>
  );
}

function ToolRow({ call }: { call: ToolCall }) {
  const step = describeStep(call.name, call.input);
  // The detail appears once the call settles if the step is a machine action:
  // while it runs, an approval dialog shows the very same command.
  const detail = call.status !== "running" || step.showDetailWhileRunning ? step.detail : "";
  const icon =
    call.status === "running" ? (
      <Spinner size={12} />
    ) : (
      <Icon
        name={call.status === "error" ? "x" : "check"}
        size={12}
        className={call.status === "error" ? "text-danger" : "text-success"}
      />
    );
  const head = (
    <>
      <span className="grid w-3 shrink-0 place-items-center">{icon}</span>
      <span className="shrink-0 text-ink-2" title={call.name}>
        {call.status === "running" ? step.active : step.done}
      </span>
      {detail && <span className="min-w-0 truncate text-ink-3">{detail.slice(0, 200)}</span>}
    </>
  );
  if (!call.output) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0">{head}</div>
    );
  }
  return (
    <details className="group border-b border-border text-xs last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
        {head}
        <Icon
          name="chevron"
          size={12}
          className="ml-auto shrink-0 text-ink-3 transition-transform group-open:rotate-90"
        />
      </summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border bg-bg/60 px-2.5 py-2 font-mono text-[11px] text-ink-3">
        {call.output.slice(0, 1500)}
      </pre>
    </details>
  );
}
