/** Turning an owner's message into a conversation turn, one task per chat. */
import type { Agent } from "@/types/domain";
import type { ChannelRef } from "../approval";
import { invoke } from "../platform";
import { errorMessage } from "../runError";
import { runConversationTurn } from "../conversationTurn";
import { useConversations } from "@/stores/conversations";
import { hasPendingFor } from "./approvals";
import { chatKeyOf, quiet, rt, sendText, type InboundMessage } from "./send";

/** "typing…" expires after ~5s on both providers; refresh just before. */
const TYPING_REFRESH_MS = 4500;
const LOG_PREVIEW_CHARS = 140;

const controllers = new Map<string, AbortController>();
const queues = new Map<string, Promise<void>>();

/** Cancel the task running in a chat. Returns whether one was running. */
export function abortChat(chatKey: string): boolean {
  const running = controllers.get(chatKey);
  running?.abort();
  return !!running;
}

/** Fetch an owner's attachments into ~/Downloads/Forge; returns local paths. */
async function fetchFiles(ref: ChannelRef, files: InboundMessage["files"]): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files) {
    try {
      paths.push(
        await invoke<string>("channel_fetch_file", {
          kind: ref.kind,
          token: ref.token,
          fileRef: f.file_ref,
          name: f.name,
        }),
      );
    } catch (e) {
      rt().log(ref.key, "system", `Couldn't download ${f.name}: ${errorMessage(e)}`);
    }
  }
  return paths;
}

function promptFor(msg: InboundMessage, paths: string[]): string {
  const files = paths.length
    ? `\n\n[The user sent ${paths.length} file(s), saved on this computer at:\n${paths.map((p) => `- ${p}`).join("\n")}]`
    : "";
  return (msg.text || "(no text — see the attached files)") + files;
}

async function runForChat(agent: Agent, ref: ChannelRef, msg: InboundMessage): Promise<void> {
  const chatKey = chatKeyOf(ref);
  if (agent.status === "paused") {
    quiet(sendText(ref, `${agent.name} is paused. Resume it in Forge to pick this up.`));
    rt().log(ref.key, "system", `Ignored a message: ${agent.name} is paused`);
    return;
  }
  const controller = new AbortController();
  controllers.set(chatKey, controller);
  rt().setBusy(chatKey, true);

  const typing = () => quiet(invoke("channel_typing", { kind: ref.kind, token: ref.token, chatId: ref.chatId }));
  typing();
  const typingTimer = setInterval(typing, TYPING_REFRESH_MS);

  try {
    const prompt = promptFor(msg, await fetchFiles(ref, msg.files));
    const convId = useConversations
      .getState()
      .conversationFor(agent.id, { kind: ref.kind, key: chatKey, from: msg.from });

    const result = await runConversationTurn(agent, convId, prompt, {
      trigger: "channel",
      signal: controller.signal,
      channel: ref,
      headless: true,
      summary: () => `${ref.kind}: ${msg.text.slice(0, 50)}`,
    });
    const reply = result.text || "Done.";
    await sendText(ref, reply);
    rt().log(ref.key, "out", reply.slice(0, LOG_PREVIEW_CHARS));
  } catch (err) {
    const text = err instanceof Error && err.name === "AbortError" ? "Stopped." : `⚠️ ${errorMessage(err)}`;
    quiet(sendText(ref, text));
    rt().log(ref.key, "system", text.slice(0, LOG_PREVIEW_CHARS));
  } finally {
    clearInterval(typingTimer);
    controllers.delete(chatKey);
    rt().setBusy(chatKey, false);
  }
}

/** One task at a time per chat; later messages wait their turn. */
export function enqueue(agent: Agent, ref: ChannelRef, msg: InboundMessage): void {
  const chatKey = chatKeyOf(ref);
  if (rt().busy[chatKey]) {
    quiet(
      sendText(
        ref,
        hasPendingFor(chatKey)
          ? "An approval is waiting above — answer it first. Your new message is queued (/stop cancels the current task)."
          : "Queued — I'll start on this when the current task finishes. /stop cancels it.",
      ),
    );
  }
  const prev = queues.get(chatKey) ?? Promise.resolve();
  const next = prev.then(() => runForChat(agent, ref, msg));
  queues.set(chatKey, next);
  void next.finally(() => {
    if (queues.get(chatKey) === next) queues.delete(chatKey);
  });
}
