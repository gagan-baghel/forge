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
  it("exposes run_shell and write_file only when the skill is enabled", () => {
    expect(Object.keys(buildTools(agent).executors).sort()).toEqual(["run_shell", "write_file"]);

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
    setApprover(async () => false);
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "echo hi" }, { agent });
    expect(out).toMatch(/denied/i);
    expect(invoked).not.toHaveBeenCalled();
  });

  it("shows the user the command and cwd before running it", async () => {
    const seen: string[] = [];
    setApprover(async (o) => {
      seen.push(`${o.title}|${o.body}`);
      return false;
    });
    const { executors } = buildTools(agent);
    await executors.run_shell({ command: "git status", cwd: "/repo", purpose: "check the tree" }, { agent });
    expect(seen[0]).toContain("git status");
    expect(seen[0]).toContain("/repo");
    expect(seen[0]).toContain("check the tree");
  });

  it("runs the command once approved and returns its output", async () => {
    setApprover(async () => true);
    const { executors } = buildTools(agent);
    const out = await executors.run_shell({ command: "echo hi" }, { agent });
    expect(out).toContain("exit code: 0");
    expect(out).toContain("hi");
  });
});
