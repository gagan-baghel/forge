import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "@/views/agent/Chat";
import { resetStores } from "@/test/reset";
import { mockStreamingFetch, textTurn, toolTurn } from "@/test/mockClaude";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { useRuns } from "@/stores/runs";

function makeAgent() {
  const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
  return useGaps.getState().addAgent(gap.id, { name: "Scout", role: "Researcher" });
}

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key" });
});

describe("agent chat (end to end)", () => {
  it("sends a message and streams an assistant reply, recording a run", async () => {
    mockStreamingFetch([textTurn("The answer is 42.", 20, 9)]);
    const agent = makeAgent();
    const user = userEvent.setup();

    render(<Chat agent={agent} />);

    const box = screen.getByPlaceholderText(/Message Scout/i);
    await user.type(box, "What is the answer?");
    await user.keyboard("{Enter}");

    // User message appears (bubble + conversation title) and the assistant reply streams in.
    expect((await screen.findAllByText("What is the answer?")).length).toBeGreaterThan(0);
    expect(await screen.findByText("The answer is 42.")).toBeInTheDocument();

    // A successful run was recorded with token accounting.
    await waitFor(() => {
      const runs = useRuns.getState().runs;
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("success");
      expect(runs[0].tokensIn).toBe(20);
      expect(runs[0].tokensOut).toBe(9);
    });
  });

  it("runs the tool-use loop: tool turn → tool result → final answer", async () => {
    // Turn 1 calls the `remember` tool (no network); turn 2 returns final text.
    mockStreamingFetch([
      toolTurn("remember", { text: "user likes tea" }),
      textTurn("Noted — I'll remember that."),
    ]);

    const gap = useGaps.getState().createGap({ name: "P", description: "" });
    const agent = useGaps.getState().addAgent(gap.id, {
      name: "Mem",
      role: "assistant",
      skills: [{ id: "s", name: "Memory", kind: "memory", description: "", enabled: true }],
    });

    const user = userEvent.setup();
    render(<Chat agent={agent} />);
    await user.type(screen.getByPlaceholderText(/Message Mem/i), "remember I like tea");
    await user.keyboard("{Enter}");

    // The final assistant answer appears and the tool chip is shown.
    expect(await screen.findByText("Noted — I'll remember that.")).toBeInTheDocument();
    expect(await screen.findByText("remember")).toBeInTheDocument();

    // The tool actually executed — the fact was stored in agent memory.
    const { useMemory } = await import("@/stores/memory");
    await waitFor(() => {
      expect(useMemory.getState().recall(agent.id, "tea")[0]?.text).toMatch(/tea/);
    });
  });
});
