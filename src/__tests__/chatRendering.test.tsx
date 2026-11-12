import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Markdown } from "@/components/Markdown";
import { describeStep, elapsed } from "@/lib/activity";

const openUrl = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

describe("chat markdown", () => {
  it("renders a GitHub table as a real table", () => {
    render(<Markdown content={"| Feature | Ancient | Modern |\n|---|---|---|\n| Accent | Pitch | Stress |\n| Cases | 5 | 4 |"} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Feature", "Ancient", "Modern"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByText(/\|---/)).toBeNull();
  });

  it("draws --- as a divider, not text", () => {
    const { container } = render(<Markdown content={"Above\n\n---\n\nBelow"} />);
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.queryByText("---")).toBeNull();
  });

  it("shows raw HTML as text instead of running it", () => {
    const { container } = render(<Markdown content={'<img src=x onerror="alert(1)"> hi'} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens links in the browser, never inside the app window", async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    render(<Markdown content={"See [Britannica](https://www.britannica.com/topic/Greek-language)."} />);
    await userEvent.click(screen.getByRole("link", { name: "Britannica" }));
    expect(openUrl).toHaveBeenCalledWith("https://www.britannica.com/topic/Greek-language");
    delete (window as any).__TAURI_INTERNALS__;
  });
});

describe("activity words", () => {
  it("names steps in plain English, with what they acted on", () => {
    expect(describeStep("WebSearch", { query: "history of Greek" })).toMatchObject({ active: "Searching the web", detail: "history of Greek" });
    expect(describeStep("WebFetch", { url: "https://www.britannica.com/topic/Greek-language" }).detail).toBe("britannica.com/topic/Greek-language");
    expect(describeStep("mcp__github__search_issues", {}).active).toBe("Using github");
    expect(describeStep("SomethingNew", {}).done).toBe("Used SomethingNew");
    expect(describeStep("ToolSearch", { query: "select:WebSearch" })).toMatchObject({ done: "Got its tools ready", detail: "" });
  });

  it("keeps commands out of the live line while an approval shows them", () => {
    expect(describeStep("run_shell", { command: "rm -rf build" }).showDetailWhileRunning).toBe(false);
    expect(describeStep("WebSearch", { query: "x" }).showDetailWhileRunning).toBe(true);
  });

  it("formats elapsed time as m:ss", () => {
    expect(elapsed(7_000)).toBe("0:07");
    expect(elapsed(125_400)).toBe("2:05");
  });
});

describe("live status while a reply is in progress", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "Date"] }));

  it("says what is happening and how long it has taken, instead of a bare spinner", async () => {
    const { Chat } = await import("@/views/agent/Chat");
    const { resetStores } = await import("@/test/reset");
    const { useGaps } = await import("@/stores/gaps");
    const { useConversations } = await import("@/stores/conversations");
    resetStores();
    vi.setSystemTime(new Date(2026, 10, 12, 10, 0, 0));
    const gap = useGaps.getState().createGap({ name: "G", description: "" });
    const agent = useGaps.getState().addAgent(gap.id, { name: "Scout", role: "r" });
    const convId = useConversations.getState().ensureConversation(agent.id);
    useConversations.getState().appendMessage(convId, { id: "u", role: "user", content: "research Greek", createdAt: Date.now() });
    useConversations.getState().appendMessage(convId, {
      id: "a",
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      pending: true,
      toolCalls: [{ id: "t", name: "WebSearch", input: { query: "history of Greek" }, status: "running" }],
    });

    render(<Chat agent={useGaps.getState().findAgent(agent.id)!.agent} />);
    expect(screen.getByText("Searching the web: history of Greek…")).toHaveAttribute("role", "status");

    act(() => vi.advanceTimersByTime(42_000));
    expect(screen.getByText("0:42")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
