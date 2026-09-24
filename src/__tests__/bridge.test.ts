import { describe, it, expect, afterEach } from "vitest";
import type { Agent } from "@/types/domain";
import { handleBridgeCall, registerBridgeRun, unregisterBridgeRun, describeCliTool } from "@/lib/bridge";
import { newTurn, setApprover } from "@/lib/approval";
import type { ToolContext } from "@/lib/tools";

const agent = { id: "a", name: "A", skills: [], connectors: [] } as unknown as Agent;

afterEach(() => {
  setApprover(null);
  unregisterBridgeRun("r1");
});

const textOf = (r: { content: any[] }) => r.content[0].text as string;

describe("tool bridge", () => {
  it("answers permission_prompt with allow + the original input when approved", async () => {
    const ctx: ToolContext = { agent, turn: newTurn() };
    registerBridgeRun("r1", { executors: {}, ctx });
    const seen: string[] = [];
    setApprover(async (o) => {
      seen.push(`${o.title}|${o.body}`);
      return "ok";
    });

    const input = { command: "git status", description: "check the tree" };
    const r = await handleBridgeCall({ call_id: 1, run_id: "r1", name: "permission_prompt", args: { tool_name: "Bash", input } });

    expect(r.isError).toBe(false);
    expect(JSON.parse(textOf(r))).toEqual({ behavior: "allow", updatedInput: input });
    expect(seen[0]).toContain("git status");
    // Approving reads nothing: provenance is marked by the result, not the
    // approval (a trust window must survive `printf x > file`).
    expect(ctx.turn!.untrusted).toBe(false);
  });

  it("answers deny with a message when refused", async () => {
    registerBridgeRun("r1", { executors: {}, ctx: { agent, turn: newTurn() } });
    setApprover(async () => "denied");
    const r = await handleBridgeCall({
      call_id: 2,
      run_id: "r1",
      name: "permission_prompt",
      args: { tool_name: "Write", input: { file_path: "/x", content: "y" } },
    });
    const body = JSON.parse(textOf(r));
    expect(body.behavior).toBe("deny");
    expect(body.message).toMatch(/denied/i);
    expect(body).not.toHaveProperty("updatedInput");
  });

  it("errors for a run that isn't registered", async () => {
    const r = await handleBridgeCall({ call_id: 3, run_id: "nope", name: "recall", args: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/finished/i);
  });

  it("runs a registered tool with its ctx and maps images to MCP image content", async () => {
    let gotCtx: ToolContext | undefined;
    const executors = {
      screenshot: async (_input: any, ctx: ToolContext) => {
        gotCtx = ctx;
        return { text: "Screenshot 10×10px", images: [{ data: "QUJD", mediaType: "image/jpeg" as const }] };
      },
    };
    const ctx: ToolContext = { agent, turn: newTurn() };
    const events: string[] = [];
    registerBridgeRun("r1", { executors, ctx, onTool: (e) => events.push(e.status) });

    const r = await handleBridgeCall({ call_id: 4, run_id: "r1", name: "screenshot", args: {} });

    expect(gotCtx).toBe(ctx);
    expect(r.isError).toBe(false);
    expect(r.content).toEqual([
      { type: "text", text: "Screenshot 10×10px" },
      { type: "image", data: "QUJD", mimeType: "image/jpeg" },
    ]);
    expect(events).toEqual(["running", "done"]);
  });

  it("flags a tool error as isError", async () => {
    registerBridgeRun("r1", { executors: {}, ctx: { agent } });
    const r = await handleBridgeCall({ call_id: 5, run_id: "r1", name: "missing", args: {} });
    expect(r.isError).toBe(true);
  });
});

describe("describeCliTool", () => {
  it("shows the command and its description for Bash", () => {
    const d = describeCliTool("Bash", { command: "rm -rf build", description: "clean" });
    expect(d.title).toMatch(/run a command/i);
    expect(d.body).toContain("rm -rf build");
    expect(d.body).toContain("clean");
  });

  it("shows the path and size for Write", () => {
    const d = describeCliTool("Write", { file_path: "/tmp/a.txt", content: "hello" });
    expect(d.title).toMatch(/write a file/i);
    expect(d.body).toContain("/tmp/a.txt");
    expect(d.body).toContain("5 characters");
  });
});
