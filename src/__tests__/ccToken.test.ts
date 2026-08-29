import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { streamClaudeCode } from "@/lib/claudeCode";
import { useSettings } from "@/stores/settings";

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

/**
 * Being signed in to `claude` in a terminal does NOT authenticate Forge's
 * headless runs — that token is short-lived and `claude -p` can't refresh it.
 * The long-lived `claude setup-token` value must reach every run, or agents
 * 401 while the terminal still works.
 */
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  listen.mockReset();
  listen.mockResolvedValue(() => {});
  useSettings.setState({ ccToken: "" });
});

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

const req = { model: "claude-opus-5", system: "", prompt: "hi", resume: "" };

describe("Claude Code background-run token", () => {
  it("passes the saved token to the run as CLAUDE_CODE_OAUTH_TOKEN", async () => {
    useSettings.setState({ ccToken: "sk-ant-oat-test" });

    void streamClaudeCode(req as any, { onText: () => {} });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("claude_code_run", expect.anything()));

    const [, args] = invoke.mock.calls.find(([c]) => c === "claude_code_run")!;
    expect((args as any).env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" });
  });

  it("sends no token env when none is saved, so the CLI uses its own session", async () => {
    void streamClaudeCode(req as any, { onText: () => {} });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("claude_code_run", expect.anything()));

    const [, args] = invoke.mock.calls.find(([c]) => c === "claude_code_run")!;
    // null, not {} — the Rust side takes Option<HashMap> and expects None.
    expect((args as any).env).toBeNull();
  });
});
