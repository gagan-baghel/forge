import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "@/views/agent/Chat";
import { DialogProvider } from "@/components/Confirm";
import { resetStores } from "@/test/reset";
import { mockStreamingFetch, textTurn, toolTurn } from "@/test/mockClaude";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { useRuns } from "@/stores/runs";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

/**
 * The whole computer-use chain in one test, with only the network and the
 * Tauri IPC boundary faked:
 *
 *   Chat UI → useChat → runAgentTurn → streamMessage → tool_use(run_shell)
 *     → buildTools/runTool → approval gate → the real confirm dialog
 *     → shell_exec → tool_result → second turn → final answer
 */
function makeAgent() {
  const gap = useGaps.getState().createGap({ name: "Pack", description: "" });
  return useGaps.getState().addAgent(gap.id, {
    name: "Scout",
    role: "Operator",
    skills: [{ id: "computer", name: "Computer", description: "", kind: "computer", enabled: true }],
  });
}

const ui = (agent: ReturnType<typeof makeAgent>) => (
  <DialogProvider>
    <Chat agent={agent} />
  </DialogProvider>
);

beforeEach(() => {
  resetStores();
  useSettings.setState({ apiKey: "test-key", runtime: "api" });
  (window as any).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockResolvedValue({ stdout: "Desktop\nDocuments", stderr: "", code: 0 });
});

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

describe("computer use (end to end)", () => {
  it("asks before running, then runs the command and answers with its output", async () => {
    mockStreamingFetch([
      toolTurn("run_shell", { command: "ls ~", purpose: "list the home directory" }),
      textTurn("You have Desktop and Documents."),
    ]);
    const user = userEvent.setup();
    render(ui(makeAgent()));

    await user.type(screen.getByPlaceholderText(/Message Scout/i), "what's in my home folder?");
    await user.keyboard("{Enter}");

    // The approval dialog must appear, showing the exact command, before anything runs.
    expect(await screen.findByText("Run a command on your computer?")).toBeInTheDocument();
    expect(screen.getByText(/ls ~/)).toBeInTheDocument();
    expect(screen.getByText(/list the home directory/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Run" }));

    // Only now does it reach the shell, with the command the user actually saw.
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("shell_exec", { command: "ls ~", cwd: undefined });

    // The tool result is fed back and the agent answers from it.
    expect(await screen.findByText("You have Desktop and Documents.")).toBeInTheDocument();

    await waitFor(() => {
      const run = useRuns.getState().runs[0];
      expect(run.status).toBe("success");
    });
  });

  it("never touches the machine when the user denies", async () => {
    mockStreamingFetch([
      toolTurn("run_shell", { command: "rm -rf ~/Documents" }),
      textTurn("Understood — I won't do that."),
    ]);
    const user = userEvent.setup();
    render(ui(makeAgent()));

    await user.type(screen.getByPlaceholderText(/Message Scout/i), "clean up my documents");
    await user.keyboard("{Enter}");

    await screen.findByText("Run a command on your computer?");
    await user.click(screen.getByRole("button", { name: "Deny" }));

    expect(await screen.findByText("Understood — I won't do that.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
