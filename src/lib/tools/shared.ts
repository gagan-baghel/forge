/** Helpers every tool module uses: approval prompts, refusals, native calls. */
import { approve, type ApprovalResult } from "../approval";
import type { ToolContext } from "./types";

/** Ask for approval in whatever way this turn's context calls for. */
export function ask(ctx: ToolContext, title: string, body: string) {
  return approve({ title, body, turn: ctx.turn, channel: ctx.channel });
}

/**
 * What the model is told when an approval didn't come back "ok". A timeout is
 * reported as its own thing: on a channel or schedule run it means nobody was
 * at the machine, and claiming the user refused would be a lie to whoever is
 * waiting on the other end.
 */
export function refusal(result: ApprovalResult, action: string): string {
  return result === "timeout"
    ? `Nobody answered the approval prompt on the user's computer in time, so this ${action} did not happen. ` +
        `Say exactly that — do not claim the user refused, and do not retry.`
    : `The user denied this ${action}. Do not retry it; ask what they'd prefer instead.`;
}

/** Call a Tauri command. Imported lazily so the web build never loads it. */
export async function native<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** A trimmed string argument, "" when absent. */
export function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Most tool responses are capped so one huge body can't flood the context. */
export const RESPONSE_LIMIT = 6000;
