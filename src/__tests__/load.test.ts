/**
 * Load and stress tests for Forge's own hot paths. Time budgets are set far
 * above what these take on a laptop, so they catch an accidental O(n²) or a
 * lost/duplicated message, not normal machine jitter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Agent, KnowledgeDoc } from "@/types/domain";
import { handleInbound, type InboundMessage } from "@/lib/channelRuntime";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { useGaps } from "@/stores/gaps";
import { useRuns } from "@/stores/runs";
import { streamMessage } from "@/lib/claude";
import { normalizeGap } from "@/lib/gapSchema";
import { retrieve } from "@/lib/knowledge";
import { resetStores } from "@/test/reset";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

/** Records every turn so ordering and overlap can be checked afterwards. */
const turns = vi.hoisted(() => ({
  log: [] as { chat: string; text: string }[],
  active: new Map<string, number>(),
  maxOverlap: 0,
}));
const runTurn = vi.hoisted(() =>
  vi.fn(async (_agent: unknown, _conv: unknown, prompt: string, opts: { channel: { chatId: string } }) => {
    const chat = opts.channel.chatId;
    const now = (turns.active.get(chat) ?? 0) + 1;
    turns.active.set(chat, now);
    turns.maxOverlap = Math.max(turns.maxOverlap, now);
    // Jitter, so chats genuinely interleave.
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    turns.log.push({ chat, text: prompt });
    turns.active.set(chat, now - 1);
    return { text: "ok", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }),
);
vi.mock("@/lib/conversationTurn", () => ({ runConversationTurn: runTurn }));

const elapsed = (start: number) => performance.now() - start;

describe("load: phone message burst", () => {
  const CHATS = 40;
  const PER_CHAT = 25;
  let agent: Agent;
  let key: string;

  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    invoke.mockReset();
    invoke.mockImplementation(async (cmd: string) => (cmd === "telegram_send" ? 1 : undefined));
    turns.log = [];
    turns.active.clear();
    turns.maxOverlap = 0;
    resetStores();
    useChannelRuntime.setState({ pairing: {}, trustUntil: {}, busy: {}, approvals: [], activity: [], running: {} });
    const gap = useGaps.getState().createGap({ name: "G", description: "" });
    agent = useGaps.getState().addAgent(gap.id, { name: "Scout", role: "helper" });
    useGaps.getState().upsertChannel(agent.id, {
      id: "c1",
      kind: "telegram",
      label: "TG",
      status: "active",
      token: "tok",
      owners: Array.from({ length: CHATS }, (_, i) => ({ id: `u${i}`, name: `U${i}`, chatId: `${i}`, pairedAt: 1 })),
    });
    key = channelKey(agent.id, "c1");
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it(`runs ${40 * 25} messages from ${40} chats: none lost, in order per chat, one at a time per chat`, async () => {
    const msg = (chat: number, n: number): InboundMessage => ({
      channel_id: key,
      chat_id: `${chat}`,
      sender_id: `u${chat}`,
      from: `U${chat}`,
      text: `m${n}`,
      kind: "message",
      files: [],
    });

    const start = performance.now();
    // Interleaved arrival, as a real poller delivers them.
    const arrivals: Promise<void>[] = [];
    for (let n = 0; n < PER_CHAT; n++) for (let c = 0; c < CHATS; c++) arrivals.push(handleInbound(msg(c, n)));
    await Promise.all(arrivals);
    await vi.waitFor(() => expect(turns.log.length).toBe(CHATS * PER_CHAT), { timeout: 20_000, interval: 20 });
    const ms = elapsed(start);

    for (let c = 0; c < CHATS; c++) {
      const order = turns.log.filter((t) => t.chat === `${c}`).map((t) => t.text);
      expect(order).toEqual(Array.from({ length: PER_CHAT }, (_, n) => `m${n}`));
    }
    expect(turns.maxOverlap).toBe(1);
    await vi.waitFor(() => expect(Object.values(useChannelRuntime.getState().busy).some(Boolean)).toBe(false));
    // The activity feed stays bounded however much traffic arrives.
    expect(useChannelRuntime.getState().activity.length).toBeLessThanOrEqual(500);
    expect(ms).toBeLessThan(15_000);
  }, 30_000);
});

describe("load: long streamed reply", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reassembles 20k deltas split across arbitrary network chunks", async () => {
    const DELTAS = 20_000;
    const enc = new TextEncoder();
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      ...Array.from({ length: DELTAS }, (_, i) => ({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: `w${i} ` },
      })),
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", usage: { output_tokens: DELTAS }, delta: { stop_reason: "end_turn" } },
    ];
    const bytes = enc.encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
    // Chunk boundaries fall mid-frame and mid-character, like a real socket.
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length;) {
      const size = 1 + Math.floor(Math.random() * 4096);
      chunks.push(bytes.slice(i, i + size));
      i += size;
    }
    let k = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => (k < chunks.length ? { done: false, value: chunks[k++] } : { done: true }),
            cancel: async () => {},
          }),
        },
      })),
    );

    let streamed = 0;
    const start = performance.now();
    const res = await streamMessage(
      { apiKey: "k", model: "claude-opus-5-5", system: "", messages: [], temperature: 0, maxTokens: 10 },
      { onText: () => streamed++ },
    );
    const ms = elapsed(start);

    expect(streamed).toBe(DELTAS);
    expect(res.text).toBe(Array.from({ length: DELTAS }, (_, i) => `w${i} `).join(""));
    expect(res.outputTokens).toBe(DELTAS);
    expect(ms).toBeLessThan(5_000);
  });
});

describe("stress: stores and data", () => {
  beforeEach(() => resetStores());

  it("keeps the run log bounded under 10k runs", () => {
    const runs = useRuns.getState();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const id = runs.startRun({ gapId: "g", agentId: "a", agentName: "A", trigger: "chat" });
      runs.finishRun(id, { status: "success", tokensIn: 1, tokensOut: 1, costUsd: 0 });
    }
    expect(useRuns.getState().runs.length).toBe(500);
    expect(elapsed(start)).toBeLessThan(10_000);
  });

  it("validates a maximum-size pack quickly", () => {
    const doc = (i: number) => ({ id: `d${i}`, title: `Doc ${i}`, content: "lorem ipsum ".repeat(4_000) });
    const pack = {
      name: "Big",
      agents: Array.from({ length: 24 }, (_, a) => ({
        name: `Agent ${a}`,
        skills: Array.from({ length: 7 }, (_, s) => ({ id: `s${s}`, kind: "code", name: "Code" })),
        knowledge: Array.from({ length: 20 }, (_, i) => doc(i)),
      })),
    };
    const start = performance.now();
    const gap = normalizeGap(pack);
    expect(gap.agents).toHaveLength(24);
    expect(gap.agents[23].knowledge).toHaveLength(20);
    expect(elapsed(start)).toBeLessThan(2_000);
  });

  it("searches 5 MB of knowledge fast enough to run before every answer", () => {
    const words = ["anvil", "forge", "ember", "quench", "temper", "billet", "slag", "tongs", "bellows", "hammer"];
    const docs: KnowledgeDoc[] = Array.from({ length: 50 }, (_, d) => {
      const content = Array.from({ length: 16_000 }, (_, i) => words[(i * 7 + d) % words.length]).join(" ");
      return { id: `d${d}`, title: `Doc ${d}`, content, bytes: content.length, addedAt: 0 };
    });
    docs[37].content += " The secret alloy ratio is seventeen to three.";

    const start = performance.now();
    const hit = retrieve(docs, "what is the secret alloy ratio");
    const ms = elapsed(start);

    expect(hit).toContain("seventeen to three");
    expect(ms).toBeLessThan(3_000);
  });
});
