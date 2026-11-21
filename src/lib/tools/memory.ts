/** `memory` skill: the agent saves durable facts. */
import { useMemory } from "@/stores/memory";
import { str } from "./shared";
import type { ClientTool } from "./types";

export const rememberTool: ClientTool = {
  def: {
    name: "remember",
    description:
      "Save a short, durable fact to long-term memory — a preference, a name, a decision. Relevant memories are " +
      "shown to you automatically before each answer, so you never need to look them up.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The fact to remember" } },
      required: ["text"],
    },
  },
  run: async (input, ctx) => {
    const text = str(input.text);
    if (!text) return "Error: nothing to remember.";
    // Learned in a pack chat, it belongs to the pack: every agent there sees it.
    const owner = ctx.packChat ? { gapId: ctx.agent.gapId } : { agentId: ctx.agent.id };
    // With review on, the user approves each fact before it counts.
    if (ctx.agent.reviewMemory) {
      useMemory.getState().propose(owner, text, ctx.agent.name);
      return "Queued for the user's approval; it will count once they keep it.";
    }
    useMemory.getState().remember(owner, text);
    return "Saved to memory.";
  },
};
