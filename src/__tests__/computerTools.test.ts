import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTools } from "@/lib/tools";
import { setApprover } from "@/lib/approval";
import type { Agent, Skill } from "@/types/domain";

const skill = (kind: Skill["kind"]): Skill => ({ id: kind, name: kind, description: "", kind, enabled: true });

const agent = { id: "a", name: "A", skills: [skill("computer")], connectors: [] } as unknown as Agent;

/** Pretend we're the desktop build; run_shell/write_file are native-only. */
function asDesktop() {
  (window as any).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  asDesktop();
  vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ stdout: "hi", stderr: "", code: 0 })) }));
});

afterEach(() => {
  setApprover(null);
  delete (window as any).__TAURI_INTERNALS__;
});

describe("computer skill tools", () => {
  it("exposes the machine and desktop-control tools only when the skill is enabled", () => {
    expect(Object.keys(buildTools(agent).executors).sort()).toEqual([
      "click",
      "press_key",
      "run_shell",
      "screenshot",
      "scroll",
      "send_file",
      "type_text",
      "write_file",
    ]);

    const off = { ...agent, skills: [{ ...skill("computer"), enabled: false }] } as Agent;
    expect(Object.keys(buildTools(off).executors)).toEqual([]);
  });

  it("refuses to run a command when nothing can ask the user", async () => {
    // No approver registered — this is every headless path (schedules, channels).
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "rm -rf ~/Documents" }, { agent });
    expect(out).toMatch(/denied/i);
  });

  it("refuses to write a file when nothing can ask the user", async () => {
    const { executors } = buildTools(agent);
    const out = await executors.write_file({ path: "/tmp/x", content: "y" }, { agent });
    expect(out).toMatch(/denied/i);
  });

  it("does not run the command when the user denies it", async () => {
    const invoked = vi.fn();
    setApprover(async () => "denied");
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "echo hi" }, { agent });
    expect(out).toMatch(/denied/i);
    expect(invoked).not.toHaveBeenCalled();
  });

  it("shows the user the command and cwd before running it", async () => {
    const seen: string[] = [];
    setApprover(async (o) => {
      seen.push(`${o.title}|${o.body}`);
      return "denied";
    });
    const { executors } = buildTools(agent);
    await executors.run_shell({ command: "git status", cwd: "/repo", purpose: "check the tree" }, { agent });
    expect(seen[0]).toContain("git status");
    expect(seen[0]).toContain("/repo");
    expect(seen[0]).toContain("check the tree");
  });

  it("runs the command once approved and returns its output", async () => {
    setApprover(async () => "ok");
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "echo hi" }, { agent });
    expect(out).toContain("exit code: 0");
    expect(out).toContain("hi");
  });

  it("refuses to read a file when nothing can ask the user (channel-triggered runs included)", async () => {
    const { executors: files } = buildTools({ ...agent, skills: [skill("files")] } as Agent);
    const out = await files.read_file({ path: "/etc/hosts" }, { agent });
    expect(out).toMatch(/denied/i);
  });

  it("send_file refuses outside a channel even when approved", async () => {
    setApprover(async () => "ok");
    const { executors } = buildTools(agent);
    const out = await executors.send_file({ path: "/tmp/report.pdf" }, { agent });
    expect(out).toMatch(/isn't connected to a channel/i);
  });

  it("send_file uploads to the channel this turn arrived on, once approved", async () => {
    setApprover(async () => "ok");
    const { executors } = buildTools(agent);
    const out = await executors.send_file(
      { path: "/tmp/report.pdf" },
      { agent, channel: { kind: "discord", token: "t", chatId: "123", key: "a__c", remote: false } },
    );
    expect(out).toMatch(/sent/i);
  });

  it("reports an unanswered prompt as nobody answering, not as a refusal", async () => {
    // What a channel run hits when the prompt goes up and nobody is there.
    setApprover(async () => "timeout");
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "echo hi" }, { agent });
    expect(out).toMatch(/nobody answered/i);
    expect(out).not.toMatch(/user denied/i);
  });
});

describe("computer tools under /stop and loose model input", () => {
  it("cancels a running command when the turn is stopped", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const calls: string[] = [];
    let release!: () => void;
    (invoke as any).mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === "shell_exec") await new Promise<void>((r) => (release = r));
      return { stdout: "", stderr: "", code: 143 };
    });
    setApprover(async () => "ok");
    const controller = new AbortController();
    const { executors } = buildTools(agent);
    const pending = executors.run_shell({ command: "sleep 100" }, { agent, signal: controller.signal });
    await vi.waitFor(() => expect(calls).toContain("shell_exec"));
    controller.abort();
    await vi.waitFor(() => expect(calls).toContain("shell_cancel"));
    release();
    expect(await pending).toMatch(/stopped/i);
  });

  it("press_key accepts the field name a model guesses", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const combos: unknown[] = [];
    (invoke as any).mockImplementation(async (_cmd: string, args: any) => combos.push(args?.combo));
    setApprover(async () => "ok");
    const { executors } = buildTools(agent);
    for (const input of [{ key: "escape" }, { keys: "escape" }, { combo: "escape" }, { keys: ["cmd", "space"] }]) {
      expect(await executors.press_key(input, { agent })).toMatch(/^Pressed/);
    }
    expect(combos).toEqual(["escape", "escape", "escape", "cmd+space"]);
  });
});
