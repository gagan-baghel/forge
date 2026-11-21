import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Gap } from "@/types/domain";
import { handleInbound, ownerChannelRef, startPairing, type InboundMessage } from "@/lib/channelRuntime";
import { exportGap, parseGapFile } from "@/lib/gapfile";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { resetStores } from "@/test/reset";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// The pack chat is real; only the agent turn at the bottom is stubbed.
const runTurn = vi.hoisted(() =>
  vi.fn(async (_agent: unknown, _conv: string, _text: string, _opts: unknown) => ({
    text: "done",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  })),
);
vi.mock("@/lib/conversationTurn", () => ({ runConversationTurn: runTurn }));

const OWNER = "u1";
const CHAT = "100";
let gap: Gap;
let key: string;

const msg = (text: string, over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel_id: key,
  chat_id: CHAT,
  sender_id: OWNER,
  from: "Ada",
  text,
  kind: "message",
  files: [],
  ...over,
});
const sent = () => invoke.mock.calls.filter(([c]) => c === "telegram_send").map(([, a]) => (a as any).text as string);
const answeredBy = () => (runTurn.mock.calls[runTurn.mock.calls.length - 1][0] as { name: string }).name;

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "telegram_send" ? 42 : undefined));
  runTurn.mockClear();
  resetStores();
  useChannelRuntime.setState({ pairing: {}, trustUntil: {}, busy: {}, approvals: [], activity: [], running: {} });

  const g = useGaps.getState().createGap({ name: "Research Lab", description: "" });
  useGaps.getState().addAgent(g.id, { name: "Scout", role: "Research" });
  useGaps.getState().addAgent(g.id, { name: "Writer", role: "Prose" });
  useGaps.getState().upsertChannel(g.id, {
    id: "telegram",
    kind: "telegram",
    label: "Telegram",
    status: "active",
    token: "secret-token",
    remoteControl: true,
    owners: [{ id: OWNER, name: "Ada", chatId: CHAT, pairedAt: 1 }],
  });
  gap = useGaps.getState().findGap(g.id)!;
  key = channelKey(gap.id, "telegram");
});

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

describe("a pack's phone bot", () => {
  it("a message goes to the pack chat: the first agent answers, in a pack conversation for that phone", async () => {
    await handleInbound(msg("find me something"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalled());
    expect(answeredBy()).toBe("Scout");
    const conv = useConversations.getState().get(runTurn.mock.calls[0][1] as string)!;
    expect(conv.gapId).toBe(gap.id);
    expect(conv.origin?.kind).toBe("telegram");
    await vi.waitFor(() => expect(sent()).toContain("done"));
  });

  it("@Name from the phone picks the agent", async () => {
    await handleInbound(msg("@Writer tidy this up"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalled());
    expect(answeredBy()).toBe("Writer");
  });

  it("strangers are blocked and pairing a phone adds an owner to the pack's bot", async () => {
    await handleInbound(msg("hi", { sender_id: "stranger", chat_id: "9" }));
    expect(runTurn).not.toHaveBeenCalled();
    const code = startPairing(gap, gap.channels![0]);
    await handleInbound(msg(`/pair ${code}`, { sender_id: "bob", chat_id: "9", from: "Bob" }));
    expect(
      useGaps
        .getState()
        .findGap(gap.id)!
        .channels![0].owners!.map((o) => o.id),
    ).toEqual([OWNER, "bob"]);
    await vi.waitFor(() => expect(sent().some((t) => t.startsWith("✅ Paired with Research Lab"))).toBe(true));
  });

  it("a pack whose agents are all paused says so instead of running", async () => {
    for (const a of gap.agents) useGaps.getState().updateAgent(a.id, { status: "paused" });
    await handleInbound(msg("anyone?"));
    await vi.waitFor(() => expect(sent().some((t) => /paused/.test(t))).toBe(true));
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("schedules on an agent without its own bot report to the pack's phone", () => {
    useChannelRuntime.setState({ running: { [key]: true } });
    expect(ownerChannelRef(gap.agents[0])?.key).toBe(key);
  });

  it("exported packs never carry the bot's token, paired phones or remote control", () => {
    const shared = parseGapFile(exportGap(useGaps.getState().findGap(gap.id)!));
    const bot = shared.channels![0];
    expect(bot.kind).toBe("telegram");
    expect(bot.token).toBeFalsy();
    expect(bot.owners ?? []).toEqual([]);
    expect(bot.remoteControl).toBeFalsy();
    expect(bot.status).toBe("inactive");
    expect(JSON.stringify(shared)).not.toContain("secret-token");
  });
});

describe("a pack with no agents yet", () => {
  it("tells the phone so, instead of claiming it's paused", async () => {
    for (const a of gap.agents) useGaps.getState().deleteAgent(a.id);
    await handleInbound(msg("hello?"));
    await vi.waitFor(() => expect(sent().some((t) => /no agents yet/.test(t))).toBe(true));
    expect(sent().some((t) => /paused/.test(t))).toBe(false);
  });
});
