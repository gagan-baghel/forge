/**
 * One test per bug found in review, so none comes back quietly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Channel, Gap } from "@/types/domain";
import { stopOrphans } from "@/lib/channelRuntime";
import { collectBackup } from "@/lib/backup";
import { mentioned, teamFor } from "@/lib/pack";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { useConversations } from "@/stores/conversations";
import { useGaps } from "@/stores/gaps";
import { usePublished } from "@/stores/published";
import { resetStores } from "@/test/reset";
import { resetPendingWrites } from "@/lib/persistStorage";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const bot = (): Channel => ({
  id: "telegram",
  kind: "telegram",
  label: "Telegram",
  status: "active",
  token: "SECRET-TOKEN",
  remoteControl: true,
  owners: [{ id: "u1", name: "Ada", chatId: "1", pairedAt: 1 }],
});

function packWithBots(): Gap {
  const g = useGaps.getState().createGap({ name: "Lab", description: "" });
  const a = useGaps.getState().addAgent(g.id, { name: "Scout", role: "x" });
  useGaps.getState().upsertChannel(g.id, bot());
  useGaps.getState().upsertChannel(a.id, bot());
  return useGaps.getState().findGap(g.id)!;
}

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetStores();
  usePublished.setState({ listings: [] });
  useChannelRuntime.setState({ running: {}, approvals: [], activity: [] });
});
afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

describe("publishing never spreads a bot token", () => {
  it("a published listing holds no tokens or paired phones", () => {
    usePublished.getState().publish(packWithBots());
    expect(JSON.stringify(usePublished.getState().listings)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(usePublished.getState().listings)).not.toContain('"owners":[{');
  });

  it("installing an old listing that still has a token doesn't copy it", () => {
    const old = packWithBots();
    const installed = useGaps.getState().installListing({
      gap: old,
      featured: false,
      installs: 0,
      rating: 0,
      category: "Yours",
    });
    expect(JSON.stringify(installed)).not.toContain("SECRET-TOKEN");
  });

  it("a backup strips tokens from published listings too", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
    } as Storage;
    // An old listing written before publishing was scrubbed.
    storage.setItem(
      "forge.published",
      JSON.stringify({ state: { listings: [{ gap: packWithBots(), featured: false }] }, version: 0 }),
    );
    Object.defineProperty(storage, "forge.published", { value: storage.getItem("forge.published"), enumerable: true });
    const backup = collectBackup(storage);
    expect(backup["forge.published"]).toBeDefined();
    expect(backup["forge.published"]).not.toContain("SECRET-TOKEN");
  });
});

describe("deleting a pack or agent stops its bot", () => {
  it("a running bot whose pack is gone is stopped", () => {
    const gap = packWithBots();
    const packKey = channelKey(gap.id, "telegram");
    const agentKey = channelKey(gap.agents[0].id, "telegram");
    useChannelRuntime.setState({ running: { [packKey]: true, [agentKey]: true } });

    stopOrphans();
    expect(invoke).not.toHaveBeenCalledWith("channel_stop", expect.anything());

    useGaps.getState().deleteGap(gap.id);
    stopOrphans();
    expect(invoke).toHaveBeenCalledWith("channel_stop", { channelId: packKey });
    expect(invoke).toHaveBeenCalledWith("channel_stop", { channelId: agentKey });
    expect(useChannelRuntime.getState().running[packKey]).toBe(false);
  });
});

describe("pack chat edge cases", () => {
  it("two agents with the same name don't put a duplicate in the tool's allowed names", () => {
    const g = useGaps.getState().createGap({ name: "P", description: "" });
    const lead = useGaps.getState().addAgent(g.id, { name: "Lead", role: "x" });
    useGaps.getState().addAgent(g.id, { name: "New agent", role: "x" });
    useGaps.getState().addAgent(g.id, { name: "New agent", role: "x" });
    const { extraTools } = teamFor(useGaps.getState().findGap(g.id)!, lead);
    const names = (extraTools![0].def.input_schema as any).properties.teammate.enum as string[];
    expect(names).toEqual(["New agent"]);
  });

  it("a nameless agent doesn't catch every '@ …' message", () => {
    const g = useGaps.getState().createGap({ name: "P", description: "" });
    useGaps.getState().addAgent(g.id, { name: "", role: "x" });
    expect(mentioned(useGaps.getState().findGap(g.id)!, "@ hello")).toBeUndefined();
  });
});

describe("replies interrupted by quitting", () => {
  it("are marked interrupted on the next start instead of thinking forever", async () => {
    localStorage.setItem(
      "forge.conversations",
      JSON.stringify({
        state: {
          conversations: [
            {
              id: "c1",
              agentId: "a",
              title: "t",
              createdAt: 0,
              updatedAt: 0,
              messages: [
                { id: "u", role: "user", content: "hi", createdAt: 0 },
                { id: "m", role: "assistant", content: "", createdAt: 0, pending: true },
              ],
            },
          ],
        },
        version: 0,
      }),
    );
    // Like a fresh launch: nothing queued in memory, only what was saved.
    resetPendingWrites();
    await useConversations.persist.rehydrate();
    const m = useConversations.getState().get("c1")!.messages[1];
    expect(m.pending).toBe(false);
    expect(m.error).toMatch(/Interrupted/);
  });
});

describe("one reply at a time per chat", () => {
  it("the send button stays off while a reply in this chat is still running", async () => {
    const { render, screen } = await import("@testing-library/react");
    const userEvent = (await import("@testing-library/user-event")).default;
    const { createElement } = await import("react");
    const { Chat } = await import("@/views/agent/Chat");
    const g = useGaps.getState().createGap({ name: "P", description: "" });
    const agent = useGaps.getState().addAgent(g.id, { name: "Scout", role: "x" });
    const conv = useConversations.getState().ensureConversation(agent.id);
    useConversations
      .getState()
      .appendMessage(conv, { id: "m", role: "assistant", content: "", createdAt: 0, pending: true });
    render(createElement(Chat, { agent }));
    await userEvent.setup().type(screen.getByPlaceholderText(/Message Scout/), "again");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
