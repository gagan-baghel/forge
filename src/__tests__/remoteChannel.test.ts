import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Agent, Channel } from "@/types/domain";
import type { ApprovalResult, ChannelRef } from "@/lib/approval";
import { newTurn } from "@/lib/approval";
import {
  handleInbound,
  remoteApprove,
  startPairing,
  MAX_PAIR_ATTEMPTS,
  type InboundMessage,
} from "@/lib/channelRuntime";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { resetStores } from "@/test/reset";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const runTurn = vi.hoisted(() => vi.fn(async () => ({ text: "done", inputTokens: 0, outputTokens: 0, costUsd: 0 })));
vi.mock("@/lib/conversationTurn", () => ({ runConversationTurn: runTurn }));

const OWNER = "u1";
const CHAT = "100";

let agent: Agent;
let key: string;

const channel = (): Channel => useGaps.getState().findAgent(agent.id)!.agent.channels[0];
const rt = () => useChannelRuntime.getState();

function msg(text: string, over: Partial<InboundMessage> = {}): InboundMessage {
  return { channel_id: key, chat_id: CHAT, sender_id: OWNER, from: "Ada", text, kind: "message", files: [], ...over };
}

const ref = (): ChannelRef => ({ kind: "telegram", token: "tok", chatId: CHAT, key, remote: true });

/** Texts sent through telegram_send, in order. */
const sent = () => invoke.mock.calls.filter(([c]) => c === "telegram_send").map(([, a]) => a as any);

/** Start a phone approval and return its pending promise and id. */
async function ask(turn = newTurn()) {
  const p = remoteApprove({ title: "Run a command on your computer?", body: "ls", turn, channel: ref() });
  await vi.waitFor(() => expect(rt().approvals.length).toBe(1));
  return { p, id: rt().approvals[0].id };
}

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "telegram_send" ? 42 : undefined));
  runTurn.mockClear();
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
    remoteControl: true,
    owners: [{ id: OWNER, name: "Ada", chatId: CHAT, pairedAt: 1 }],
  });
  key = channelKey(agent.id, "c1");
});

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

describe("strangers and pairing", () => {
  it("blocks a stranger and never runs the agent, while an owner's message does run", async () => {
    await handleInbound(msg("rm -rf ~ please", { sender_id: "evil", chat_id: "666" }));
    expect(runTurn).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sent()[0]?.text).toMatch(/private Forge agent/));

    await handleInbound(msg("hello"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
  });

  it("routes to an agent whose id ends in '_' (nanoid can produce one)", async () => {
    useGaps.setState((s) => ({
      gaps: s.gaps.map((g) => ({ ...g, agents: g.agents.map((a) => ({ ...a, id: "abc_" })) })),
    }));
    key = channelKey("abc_", "c1");
    await handleInbound(msg("hello"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
  });

  it("ignores a stranger's button press entirely", async () => {
    const { p, id } = await ask();
    await handleInbound(msg(`fa:ok:${id}`, { sender_id: "evil", kind: "callback" }));
    expect(rt().approvals).toHaveLength(1);
    await handleInbound(msg("no"));
    expect(await p).toBe("denied");
  });

  it("pairs a stranger who sends the right code, once", async () => {
    const code = startPairing(agent, channel());
    await handleInbound(msg(`/pair ${code}`, { sender_id: "u2", from: "Bob", chat_id: "200" }));
    expect(channel().owners?.map((o) => o.id)).toEqual([OWNER, "u2"]);
    expect(channel().owners?.[1].chatId).toBe("200");

    // Single use: the same code can't pair anyone else.
    await handleInbound(msg(`/pair ${code}`, { sender_id: "u3", chat_id: "300" }));
    expect(channel().owners?.map((o) => o.id)).not.toContain("u3");
  });

  it("rejects a wrong code and burns the code after too many tries", async () => {
    const code = startPairing(agent, channel());
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_PAIR_ATTEMPTS; i++) {
      await handleInbound(msg(`/pair ${wrong}`, { sender_id: "u2", chat_id: "200" }));
    }
    expect(channel().owners).toHaveLength(1);
    expect(rt().pairing[key]).toBeUndefined();

    // Even the right code is useless now.
    await handleInbound(msg(`/pair ${code}`, { sender_id: "u2", chat_id: "200" }));
    expect(channel().owners).toHaveLength(1);
  });

  it("rejects an expired code", async () => {
    const code = startPairing(agent, channel());
    rt().setPairing(key, { ...rt().pairing[key], expiresAt: Date.now() - 1 });
    await handleInbound(msg(`/pair ${code}`, { sender_id: "u2", chat_id: "200" }));
    expect(channel().owners).toHaveLength(1);
    await vi.waitFor(() => expect(sent().slice(-1)[0]?.text).toMatch(/No pairing is open/));
  });
});

describe("owner commands", () => {
  it("/new starts a fresh thread that the next message runs in", async () => {
    await handleInbound(msg("first"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    const before = (runTurn.mock.calls[0] as any[])[1];

    await handleInbound(msg("/new"));
    await handleInbound(msg("second"));
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    const after = (runTurn.mock.calls[1] as any[])[1];

    expect(after).not.toBe(before);
    expect(useConversations.getState().get(after)?.origin?.key).toBe(`${key}:${CHAT}`);
  });
});

describe("phone approvals", () => {
  it("sends Approve / Allow 15 min / Deny buttons and resolves on ok", async () => {
    const { p, id } = await ask();
    expect(sent()[0].buttons.map((b: string[]) => b[1])).toEqual([`fa:ok:${id}`, `fa:trust:${id}`, `fa:no:${id}`]);
    await handleInbound(msg(`fa:ok:${id}`, { kind: "callback" }));
    expect(await p).toBe("ok");
    expect(rt().approvals).toHaveLength(0);
  });

  it("resolves denied on no", async () => {
    const { p, id } = await ask();
    await handleInbound(msg(`fa:no:${id}`, { kind: "callback" }));
    expect(await p).toBe("denied");
  });

  it("won't let a button pressed in another chat settle the prompt", async () => {
    const { p, id } = await ask();
    await handleInbound(msg(`fa:ok:${id}`, { kind: "callback", chat_id: "999" }));
    expect(rt().approvals).toHaveLength(1);

    await handleInbound(msg(`fa:no:${id}`, { kind: "callback" }));
    expect(await p).toBe("denied");
  });

  it("'Allow 15 min' opens a window: the next action runs without buttons but is announced", async () => {
    const first = await ask();
    await handleInbound(msg(`fa:trust:${first.id}`, { kind: "callback" }));
    expect(await first.p).toBe("ok");
    expect(rt().trustUntil[`${key}:${CHAT}`]).toBeGreaterThan(Date.now());

    invoke.mockClear();
    const r = await remoteApprove({ title: "Click on your screen?", body: "at (1, 2)", turn: newTurn(), channel: ref() });
    expect(r).toBe("ok");
    expect(rt().approvals).toHaveLength(0);
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].buttons).toBeNull();
    expect(sent()[0].text).toContain("Click on your screen");
  });

  it("asks again inside the window once the turn has read outside content", async () => {
    rt().setTrust(`${key}:${CHAT}`, Date.now() + 60_000);
    const turn = newTurn();
    turn.untrusted = true;
    const { p, id } = await ask(turn);
    expect(sent()[0].buttons).toHaveLength(3);
    expect(sent()[0].text).toMatch(/outside content/);
    await handleInbound(msg(`fa:no:${id}`, { kind: "callback" }));
    expect(await p).toBe("denied");
  });

  it("/lock ends the window", async () => {
    rt().setTrust(`${key}:${CHAT}`, Date.now() + 60_000);
    await handleInbound(msg("/lock"));
    expect(rt().trustUntil[`${key}:${CHAT}`]).toBeUndefined();

    const { p, id } = await ask();
    await handleInbound(msg(`fa:no:${id}`, { kind: "callback" }));
    expect(await p).toBe("denied");
  });

  it("/stop denies every pending approval in the chat", async () => {
    const { p } = await ask();
    let result: ApprovalResult | undefined;
    void p.then((r) => (result = r));
    await handleInbound(msg("/stop"));
    await vi.waitFor(() => expect(result).toBe("denied"));
    expect(rt().approvals).toHaveLength(0);
  });
});
