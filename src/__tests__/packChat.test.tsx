import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ChatMessage, Gap } from "@/types/domain";
import * as agentRun from "@/lib/agentRun";
import { catchUp } from "@/lib/agentRun";
import { MAX_ASKS, mentioned, pickAgent, runPackTurn, teamFor, teammateTool } from "@/lib/pack";
import { approve, newTurn, setApprover } from "@/lib/approval";
import { groupRuns } from "@/lib/runGroups";
import { rememberTool } from "@/lib/tools/memory";
import { useMemory } from "@/stores/memory";
import { normalizeGap } from "@/lib/gapSchema";
import type { Run } from "@/types/domain";
import { AgentsView } from "@/views/Agents";
import { resetStores } from "@/test/reset";
import { mockStreamingFetch, textTurn, toolTurn } from "@/test/mockClaude";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useSettings } from "@/stores/settings";
import { useRuns } from "@/stores/runs";

// Pass-through by default; individual tests stub a teammate's result.
vi.mock("@/lib/agentRun", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agentRun")>();
  return { ...real, runAgentTurn: vi.fn(real.runAgentTurn) };
});

function makePack(): Gap {
  const g = useGaps.getState().createGap({ name: "Studio", description: "" });
  useGaps.getState().addAgent(g.id, { name: "Lead", role: "Coordinator" });
  useGaps.getState().addAgent(g.id, { name: "Data Analyst", role: "Numbers and charts" });
  useGaps.getState().addAgent(g.id, { name: "Writer", role: "Turns notes into prose" });
  return useGaps.getState().findGap(g.id)!;
}
const byName = (gap: Gap, name: string) => gap.agents.find((a) => a.name === name)!;
const msg = (role: ChatMessage["role"], content: string, agentId?: string): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  content,
  createdAt: 0,
  ...(agentId ? { agentId } : {}),
});
const sentBody = (spy: ReturnType<typeof mockStreamingFetch>, call: number) =>
  ((b) => ({ ...b, system: JSON.stringify(b.system) }))(
    JSON.parse(spy.mock.calls[call][1].body as string) as {
      system: unknown;
      messages: unknown[];
      tools?: { name: string }[];
    },
  );

const last = <T,>(xs: T[]): T => xs[xs.length - 1];

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key" });
});

describe("who answers in a pack chat", () => {
  it("@name picks that agent, longest name first and spaces optional", () => {
    const gap = makePack();
    expect(mentioned(gap, "@writer tidy this")?.name).toBe("Writer");
    expect(mentioned(gap, "@Data Analyst: chart it")?.name).toBe("Data Analyst");
    expect(mentioned(gap, "@DataAnalyst chart it")?.name).toBe("Data Analyst");
    expect(mentioned(gap, "@Writers unite")).toBeUndefined();
    expect(mentioned(gap, "hi @writer")).toBeUndefined();
  });

  it("without @, whoever answered last keeps the thread; else the first active agent", () => {
    const gap = makePack();
    const writer = byName(gap, "Writer");
    expect(pickAgent(gap, [], "hello")?.name).toBe("Lead");
    expect(pickAgent(gap, [msg("user", "x"), msg("assistant", "y", writer.id)], "shorter")?.name).toBe("Writer");
    useGaps.getState().updateAgent(byName(gap, "Lead").id, { status: "paused" });
    expect(pickAgent(useGaps.getState().findGap(gap.id)!, [], "hello")?.name).toBe("Data Analyst");
  });

  it("a one-agent pack gets no team tool and no roster: zero extra tokens", () => {
    const g = useGaps.getState().createGap({ name: "Solo", description: "" });
    const only = useGaps.getState().addAgent(g.id, { name: "Only", role: "Everything" });
    expect(teamFor(useGaps.getState().findGap(g.id)!, only)).toEqual({});
  });

  it("paused teammates are left off the roster", () => {
    const gap = makePack();
    useGaps.getState().updateAgent(byName(gap, "Writer").id, { status: "paused" });
    const fresh = useGaps.getState().findGap(gap.id)!;
    const { extraSystem, extraTools } = teamFor(fresh, byName(fresh, "Lead"));
    expect(extraSystem).toContain("Data Analyst");
    expect(extraSystem).not.toContain("Writer");
    expect((extraTools![0].def.input_schema as any).properties.teammate.enum).toEqual(["Data Analyst"]);
  });
});

describe("shared history", () => {
  it("catches a Claude Code turn up on what teammates said since it last spoke", () => {
    const gap = makePack();
    const lead = byName(gap, "Lead");
    const writer = byName(gap, "Writer");
    const history = [
      msg("user", "plan it"),
      msg("assistant", "here's the plan", lead.id),
      msg("user", "@Writer draft it"),
      msg("assistant", "the draft", writer.id),
      msg("user", "@Lead thoughts?"),
    ];
    const text = catchUp(history, lead.id);
    expect(text).toContain("User: @Writer draft it");
    expect(text).toContain("Writer: the draft");
    expect(text).not.toContain("here's the plan");
    expect(text).not.toContain("thoughts?");
  });

  it("adds nothing to an ordinary one-agent chat", () => {
    const history = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    expect(catchUp(history, "any")).toBe("");
  });
});

describe("pack chat turn (end to end)", () => {
  it("the first agent hands a task to a teammate and replies once", async () => {
    const spy = mockStreamingFetch([
      toolTurn("ask_teammate", { teammate: "Writer", request: "Write one line about tea." }),
      textTurn("Tea is a leaf with ambitions."),
      textTurn("Here it is: Tea is a leaf with ambitions."),
    ]);
    const gap = makePack();
    const convId = useConversations.getState().newPackConversation(gap.id);

    const result = await runPackTurn(gap, convId, "Give me a line about tea", { trigger: "chat" });

    expect(result.text).toBe("Here it is: Tea is a leaf with ambitions.");
    expect(spy).toHaveBeenCalledTimes(3);
    const lead = sentBody(spy, 0);
    expect(lead.system).toContain("Writer: Turns notes into prose");
    expect(lead.tools?.map((t) => t.name)).toContain("ask_teammate");
    // The teammate gets the brief, not the chat, and cannot hand off again.
    const mate = sentBody(spy, 1);
    expect(JSON.stringify(mate.messages)).toContain("Lead, your teammate in this pack, asks");
    expect(JSON.stringify(mate.messages)).not.toContain("Give me a line about tea");
    expect(mate.tools?.map((t) => t.name) ?? []).not.toContain("ask_teammate");

    const reply = last(useConversations.getState().get(convId)!.messages);
    expect(reply.agentId).toBe(byName(gap, "Lead").id);
    expect(reply.toolCalls?.[0]).toMatchObject({ name: "ask_teammate", status: "done" });
    // Both agents' work shows up in Activity.
    expect(
      useRuns
        .getState()
        .runs.map((r) => r.agentName)
        .sort(),
    ).toEqual(["Lead", "Writer"]);
  });

  it("@name goes straight to that agent", async () => {
    const spy = mockStreamingFetch([textTurn("Writer here.")]);
    const gap = makePack();
    const convId = useConversations.getState().newPackConversation(gap.id);
    await runPackTurn(gap, convId, "@Writer say hi", { trigger: "chat" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sentBody(spy, 0).system).toContain("You are Writer");
    expect(last(useConversations.getState().get(convId)!.messages).agentId).toBe(byName(gap, "Writer").id);
  });

  it("tags a teammate's earlier reply so the next agent doesn't take it for its own", async () => {
    const spy = mockStreamingFetch([textTurn("draft"), textTurn("review")]);
    const gap = makePack();
    const convId = useConversations.getState().newPackConversation(gap.id);
    await runPackTurn(gap, convId, "@Writer draft", { trigger: "chat" });
    await runPackTurn(gap, convId, "@Lead review it", { trigger: "chat" });
    expect(JSON.stringify(sentBody(spy, 1).messages)).toContain("[Writer] draft");
  });
});

describe("ask_teammate limits", () => {
  it(`stops after ${MAX_ASKS} hand-offs in one turn`, async () => {
    mockStreamingFetch([textTurn("ok")]);
    const gap = makePack();
    const tool = teammateTool(byName(gap, "Lead"), [byName(gap, "Writer")]);
    const ctx = { agent: byName(gap, "Lead"), turn: newTurn() };
    for (let i = 0; i < MAX_ASKS; i++) expect(await tool.run({ teammate: "Writer", request: "go" }, ctx)).toBe("ok");
    expect(await tool.run({ teammate: "Writer", request: "go" }, ctx)).toMatch(/^Error: you've asked/);
  });

  it("rejects an unknown teammate", async () => {
    const gap = makePack();
    const tool = teammateTool(byName(gap, "Lead"), [byName(gap, "Writer")]);
    expect(await tool.run({ teammate: "Ghost", request: "go" }, { agent: byName(gap, "Lead") })).toMatch(
      /no teammate named "Ghost"/,
    );
  });

  it("carries outside-content taint both ways", async () => {
    const gap = makePack();
    const tool = teammateTool(byName(gap, "Lead"), [byName(gap, "Writer")]);
    const run = vi.mocked(agentRun.runAgentTurn);
    run.mockResolvedValueOnce({ text: "found it", inputTokens: 1, outputTokens: 1, costUsd: 0, untrusted: true });
    const turn = newTurn();
    turn.untrusted = false;
    const out = await tool.run({ teammate: "Writer", request: "look it up" }, { agent: byName(gap, "Lead"), turn });
    expect(out).toContain("<untrusted-content");
    expect(turn.untrusted).toBe(true);

    run.mockResolvedValueOnce({ text: "fine", inputTokens: 1, outputTokens: 1, costUsd: 0 });
    await tool.run({ teammate: "Writer", request: "again" }, { agent: byName(gap, "Lead"), turn });
    expect(last(run.mock.calls)[2].untrusted).toBe(true);
  });
});

describe("Agents page", () => {
  it("lists packs, and the dropdown opens onto each pack's agents", async () => {
    makePack();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentsView />
      </MemoryRouter>,
    );
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.queryByText("Numbers and charts")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show agents in studio/i }));
    expect(screen.getByText("Numbers and charts")).toBeInTheDocument();
  });
});

describe("pack and agent knowledge", () => {
  it("pack memory reaches every agent in the pack; agent memory stays with its agent", () => {
    const gap = makePack();
    const other = useGaps.getState().createGap({ name: "Other", description: "" });
    const outsider = useGaps.getState().addAgent(other.id, { name: "Out", role: "x" });
    const lead = byName(gap, "Lead");
    const writer = byName(gap, "Writer");
    useMemory.getState().remember({ gapId: gap.id }, "Client is Acme");
    useMemory.getState().remember({ agentId: writer.id }, "Writer prefers short lines");

    const recall = (a: { id: string; gapId: string }) =>
      useMemory
        .getState()
        .recall(a.id, "", 8, a.gapId)
        .map((n) => n.text);
    expect(recall(lead)).toEqual(["Client is Acme"]);
    expect(recall(writer).sort()).toEqual(["Client is Acme", "Writer prefers short lines"]);
    expect(recall(outsider)).toEqual([]);
  });

  it("a fact saved in a pack chat goes to the pack; in a direct chat, to the agent", async () => {
    const gap = makePack();
    const writer = byName(gap, "Writer");
    await rememberTool.run({ text: "Shared fact" }, { agent: writer, packChat: true });
    await rememberTool.run({ text: "Private fact" }, { agent: writer });
    expect(
      useMemory
        .getState()
        .forPack(gap.id)
        .map((n) => n.text),
    ).toEqual(["Shared fact"]);
    expect(
      useMemory
        .getState()
        .forAgent(writer.id)
        .map((n) => n.text),
    ).toEqual(["Private fact"]);
  });

  it("pack documents reach the agent's prompt alongside its own", async () => {
    const spy = mockStreamingFetch([textTurn("ok")]);
    const gap = makePack();
    useGaps.getState().addPackKnowledge(gap.id, {
      title: "Brand guide",
      content: "Our tone is plain and warm.",
      bytes: 27,
    });
    const convId = useConversations.getState().newConversation(byName(gap, "Writer").id);
    const { runConversationTurn } = await import("@/lib/conversationTurn");
    await runConversationTurn(byName(gap, "Writer"), convId, "What is our tone?", { trigger: "chat" });
    // Document search may fetch its embedding model first; find the Claude request.
    const claudeCall = spy.mock.calls.findIndex((c) => String(c[0]).includes("/v1/messages"));
    expect(sentBody(spy, claudeCall).system).toContain("Our tone is plain and warm.");
  });

  it("pack documents survive a .gap round trip, and old packs without them still load", () => {
    const gap = makePack();
    useGaps.getState().addPackKnowledge(gap.id, { title: "Guide", content: "text", bytes: 4 });
    const fresh = useGaps.getState().findGap(gap.id)!;
    expect(normalizeGap(JSON.parse(JSON.stringify(fresh))).knowledge?.[0].title).toBe("Guide");
    const old = JSON.parse(JSON.stringify(fresh));
    delete old.knowledge;
    expect(normalizeGap(old).knowledge).toBeUndefined();
  });
});

describe("activity", () => {
  const run = (p: Partial<Run>): Run => ({
    id: Math.random().toString(36).slice(2),
    gapId: "g",
    agentId: "a",
    agentName: "A",
    status: "success",
    trigger: "chat",
    startedAt: 0,
    endedAt: 1,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    ...p,
  });

  it("folds one pack-chat message into one entry; agent runs on their own stay separate", () => {
    const entries = groupRuns([
      run({ agentName: "Solo", startedAt: 30 }),
      run({ group: "m1", agentName: "Writer", startedAt: 21, status: "error" }),
      run({ group: "m1", agentName: "Lead", startedAt: 20 }),
      run({ agentName: "Solo", startedAt: 10 }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["run", "pack", "run"]);
    const pack = entries[1] as Extract<(typeof entries)[number], { kind: "pack" }>;
    expect(pack.runs.map((r) => r.agentName)).toEqual(["Lead", "Writer"]);
    expect(pack.status).toBe("error");
    expect(pack.tokens).toBe(4);
  });

  it("every run caused by one pack message shares a group", async () => {
    mockStreamingFetch([
      toolTurn("ask_teammate", { teammate: "Writer", request: "Line about tea." }),
      textTurn("Tea."),
      textTurn("Done."),
    ]);
    const gap = makePack();
    const convId = useConversations.getState().newPackConversation(gap.id);
    await runPackTurn(gap, convId, "go", { trigger: "chat" });
    const groups = new Set(useRuns.getState().runs.map((r) => r.group));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });
});

describe("speed", () => {
  it("teammates asked in the same step work at the same time", async () => {
    const twoAsks = [
      { type: "message_start", message: { usage: { input_tokens: 8 } } },
      ...["Writer", "Data Analyst"].flatMap((name, i) => [
        {
          type: "content_block_start",
          index: i,
          content_block: { type: "tool_use", id: `t${i}`, name: "ask_teammate", input: {} },
        },
        {
          type: "content_block_delta",
          index: i,
          delta: { type: "input_json_delta", partial_json: JSON.stringify({ teammate: name, request: "help" }) },
        },
        { type: "content_block_stop", index: i },
      ]),
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];
    mockStreamingFetch([twoAsks, textTurn("Both answered.")]);
    const gap = makePack();
    const lead = byName(gap, "Lead");
    const run = vi.mocked(agentRun.runAgentTurn);
    const real = (await vi.importActual<typeof import("@/lib/agentRun")>("@/lib/agentRun")).runAgentTurn;
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((r) => (release = r));
    run.mockImplementation(async (agent, history, opts) => {
      if (agent.id === lead.id) return real(agent, history, opts);
      if (++started === 2) release();
      // Sequential execution would never start the second one: fail fast instead of hanging.
      const ok = await Promise.race([
        bothStarted.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 500)),
      ]);
      if (!ok) throw new Error("teammates ran one after another");
      return { text: `${agent.name} done`, inputTokens: 1, outputTokens: 1, costUsd: 0 };
    });
    try {
      const convId = useConversations.getState().newPackConversation(gap.id);
      const result = await runPackTurn(gap, convId, "go", { trigger: "chat" });
      expect(result.text).toBe("Both answered.");
      expect(started).toBe(2);
    } finally {
      run.mockImplementation(real);
    }
  });

  it("approval prompts that arrive together are shown one after another", async () => {
    const shown: string[] = [];
    let answerFirst!: () => void;
    setApprover(
      (opts) =>
        new Promise((resolve) => {
          shown.push(opts.title);
          if (shown.length === 1) answerFirst = () => resolve("ok");
          else resolve("ok");
        }),
    );
    const agent = byName(makePack(), "Lead");
    const a = approve({ title: "first", body: "", agent } as any);
    const b = approve({ title: "second", body: "", agent } as any);
    await new Promise((r) => setTimeout(r, 0));
    expect(shown).toEqual(["first"]);
    answerFirst();
    expect(await a).toBe("ok");
    expect(await b).toBe("ok");
    expect(shown).toEqual(["first", "second"]);
    setApprover(null);
  });
});

describe("agent Knowledge tab", () => {
  it("shows the agent's own items and, separately, what its pack shares", async () => {
    const { KnowledgeTab } = await import("@/views/agent/KnowledgeTab");
    const gap = makePack();
    const writer = byName(gap, "Writer");
    useGaps.getState().addPackKnowledge(gap.id, { title: "House style", content: "x", bytes: 1 });
    useMemory.getState().remember({ gapId: gap.id }, "Client is Acme");
    useMemory.getState().remember({ agentId: writer.id }, "Short lines");
    const { DialogProvider } = await import("@/components/Confirm");
    render(
      <MemoryRouter>
        <DialogProvider>
          <KnowledgeTab agent={writer} />
        </DialogProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Also shared by Studio")).toBeInTheDocument();
    expect(screen.getByText("House style")).toBeInTheDocument();
    expect(screen.getByText("Client is Acme")).toBeInTheDocument();
    expect(screen.getByText("Short lines")).toBeInTheDocument();
  });
});
