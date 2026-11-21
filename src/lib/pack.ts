/**
 * Pack chat: talking to a whole pack instead of one agent.
 *
 * There is no hidden router call. A message goes to the agent named with
 * `@Name`, else to whoever answered last, else to the pack's first active
 * agent. That agent sees a one-line roster of its teammates and an
 * `ask_teammate` tool, and hands work over only when a teammate fits better —
 * so an ordinary message costs exactly what a one-agent chat costs, and a
 * hand-off costs one teammate turn.
 *
 * A teammate gets a self-contained brief, not the whole chat, and cannot ask
 * anyone else in turn: one level deep, MAX_ASKS per turn. Bounded cost, no loops.
 */
import { nanoid } from "nanoid";
import type { Agent, ChatMessage, Gap } from "@/types/domain";
import { useConversations } from "@/stores/conversations";
import { runAgentTurn, type AgentTurnResult } from "./agentRun";
import { runConversationTurn, type ConversationTurnOpts } from "./conversationTurn";
import { recordRun } from "./runner";
import type { ClientTool } from "./tools";
import { fenceUntrusted } from "./tools/untrusted";

/** Hand-offs one turn may make. Each is a full teammate turn, so this is the cost ceiling. */
export const MAX_ASKS = 3;

const norm = (s: string) => s.trim().toLowerCase();
const working = (a: Agent) => a.status !== "paused";

/** The agent a message starting `@Name` addresses. Longest name first, so "@Data Analyst" beats "@Data". */
export function mentioned(gap: Gap, text: string): Agent | undefined {
  if (!text.startsWith("@")) return undefined;
  const after = norm(text.slice(1));
  // Nameless agents can't be addressed: "" would match every "@ …".
  const byLength = gap.agents.filter((a) => a.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const a of byLength) {
    for (const n of new Set([norm(a.name), norm(a.name).replace(/\s+/g, "")])) {
      if (after.startsWith(n) && (after.length === n.length || /[\s,:.!?]/.test(after[n.length]))) return a;
    }
  }
  return undefined;
}

/** Who answers: the @-named agent, else whoever answered last, else the first active agent. */
export function pickAgent(gap: Gap, history: ChatMessage[], text: string): Agent | undefined {
  const named = mentioned(gap, text);
  if (named) return named;
  const lastId = [...history].reverse().find((m) => m.role === "assistant" && m.agentId)?.agentId;
  return gap.agents.find((a) => a.id === lastId && working(a)) ?? gap.agents.find(working) ?? gap.agents[0];
}

/** The roster and hand-off rules, kept short: they ride along on every turn. */
function teamBrief(gap: Gap, self: Agent, mates: Agent[]): string {
  return (
    `\n\nYou are ${self.name}, one of the agents in the "${gap.name}" pack, talking with the user in a shared chat. ` +
    `Your teammates:\n${mates.map((a) => `- ${a.name}: ${a.role}`).join("\n")}\n` +
    "Answer yourself when you can. Use ask_teammate only when a teammate's role clearly covers part of the task " +
    "better than yours. They can't see this chat, so give them a complete request with the facts they need and say " +
    "exactly what to send back. To involve several teammates, ask them all in the same step: they work at the same " +
    "time. Their answers come to you, not the user: work them into one reply. " +
    "History lines tagged [Name] were written by that teammate."
  );
}

/**
 * `ask_teammate`, built per turn so its hand-off count starts at zero. `group`
 * files the teammate's run under the same pack-chat message in Activity.
 */
export function teammateTool(caller: Agent, mates: Agent[], group?: string): ClientTool {
  // Unique: two agents both called "New agent" would put a duplicate in the
  // tool's enum, which the API may reject — failing every message in the pack.
  const names = [...new Set(mates.map((a) => a.name))];
  let asks = 0;
  return {
    def: {
      name: "ask_teammate",
      description:
        "Hand one self-contained task to a teammate in this pack and get their answer back. " +
        "They don't see this conversation.",
      input_schema: {
        type: "object",
        properties: {
          teammate: { type: "string", enum: names },
          request: {
            type: "string",
            description: "Everything they need: the task, the relevant facts, and the output you want back.",
          },
        },
        required: ["teammate", "request"],
      },
    },
    run: async (input, ctx) => {
      const name = typeof input.teammate === "string" ? input.teammate : "";
      const request = typeof input.request === "string" ? input.request.trim() : "";
      const mate = mates.find((a) => norm(a.name) === norm(name));
      if (!mate) return `Error: no teammate named "${name}". Teammates: ${names.join(", ")}.`;
      if (!request) return "Error: the request is empty.";
      if (++asks > MAX_ASKS)
        return `Error: you've asked teammates ${MAX_ASKS} times this turn. Finish with what you have.`;

      const brief: ChatMessage[] = [
        {
          id: "ask",
          role: "user",
          content: `${caller.name}, your teammate in this pack, asks:\n\n${request}`,
          createdAt: Date.now(),
        },
      ];
      const result: AgentTurnResult = await recordRun(
        mate,
        ctx.channel ? "channel" : "chat",
        () =>
          runAgentTurn(mate, brief, {
            onText: () => {},
            signal: ctx.signal,
            channel: ctx.channel,
            headless: ctx.headless,
            // A request written after reading outside content carries that taint along.
            untrusted: ctx.turn?.untrusted,
            packChat: true,
          }),
        { summary: (r) => `For ${caller.name}: ${r.text.slice(0, 60)}`, group },
      );
      const answer = result.text.trim() || "(no answer)";
      if (!result.untrusted) return answer;
      // The teammate read outside content; its answer may carry an injection back.
      if (ctx.turn) ctx.turn.untrusted = true;
      return fenceUntrusted("ask_teammate", answer);
    },
  };
}

/** The extra tool and roster an agent gets in a pack chat. Nothing when it has no working teammates. */
export function teamFor(
  gap: Gap,
  self: Agent,
  group?: string,
): Pick<ConversationTurnOpts, "extraTools" | "extraSystem"> {
  const mates = gap.agents.filter((a) => a.id !== self.id && working(a));
  if (mates.length === 0) return {};
  return { extraTools: [teammateTool(self, mates, group)], extraSystem: teamBrief(gap, self, mates) };
}

/** One turn of a pack chat. */
export async function runPackTurn(
  gap: Gap,
  conversationId: string,
  text: string,
  opts: Omit<ConversationTurnOpts, "extraTools" | "extraSystem" | "group">,
): Promise<AgentTurnResult> {
  const history = useConversations.getState().get(conversationId)?.messages ?? [];
  const agent = pickAgent(gap, history, text);
  if (!agent) throw new Error("This pack has no agents yet.");
  const group = nanoid(8);
  return runConversationTurn(agent, conversationId, text, { ...opts, group, ...teamFor(gap, agent, group) });
}
