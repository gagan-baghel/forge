import type { Agent } from "@/types/domain";
import type { ToolDef } from "../claude";
import type { ChannelRef, TurnState } from "../approval";

export interface ToolContext {
  agent: Agent;
  /** Optional progress callback (e.g. to surface "ran web_search" in the UI). */
  onActivity?: (label: string) => void;
  /**
   * Set when this turn is answering an inbound message on a connected channel
   * (Discord/Telegram) rather than the in-app chat. Lets tools like send_file
   * reply through that same channel, and routes approvals to the phone when
   * the channel has remote control on.
   */
  channel?: ChannelRef;
  /** Per-turn provenance; created on first use when a caller omits it. */
  turn?: TurnState;
  /** The turn's cancel signal: a Stop also ends a running command. */
  signal?: AbortSignal;
  /** Nobody is necessarily at the machine (channel and schedule runs). */
  headless?: boolean;
  /** Part of a pack chat: memories are saved to the pack, not the agent. */
  packChat?: boolean;
}

/** An image a tool hands back to the model (a screenshot, say). */
export interface ToolImage {
  data: string;
  mediaType: "image/jpeg" | "image/png";
}

/** What a tool returns: plain text, or text plus images. */
export type ToolOutput = string | { text: string; images: ToolImage[] };

/** Model-supplied tool arguments. Untrusted: every executor coerces what it reads. */
export type ToolInput = Record<string, unknown>;

export type Executor = (input: ToolInput, ctx: ToolContext) => Promise<ToolOutput>;

/** A tool Forge runs itself: its API definition plus the code behind it. */
export interface ClientTool {
  def: ToolDef;
  run: Executor;
}

export function outputText(out: ToolOutput): string {
  return typeof out === "string" ? out : out.text;
}
