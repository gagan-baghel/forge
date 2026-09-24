import { describe, it, expect, beforeEach } from "vitest";
import type { Gap } from "@/types/domain";
import { exportGap } from "@/lib/gapfile";
import { applyBackup, collectBackup } from "@/lib/backup";

const SECRETS = ["123:BOT-TOKEN", "https://discord.com/api/webhooks/1/abc", "owner-42", "ghp_CONNECTOR"];

function gap(): Gap {
  return {
    id: "g1",
    slug: "g",
    name: "G",
    description: "",
    agents: [
      {
        id: "a1",
        gapId: "g1",
        name: "Scout",
        role: "r",
        skills: [],
        knowledge: [],
        connectors: [{ id: "co1", provider: "github", label: "GH", status: "connected", scopes: ["ghp_CONNECTOR"] }],
        channels: [
          {
            id: "ch1",
            kind: "telegram",
            label: "TG",
            status: "active",
            token: "123:BOT-TOKEN",
            remoteControl: true,
            owners: [{ id: "owner-42", name: "Ada", chatId: "100", pairedAt: 1 }],
            config: { webhook: "https://discord.com/api/webhooks/1/abc", trigger: "mention" },
          },
        ],
      },
    ],
  } as unknown as Gap;
}

const gapsBlob = (g: Gap) => JSON.stringify({ state: { gaps: [g] }, version: 0 });

beforeEach(() => localStorage.clear());

describe("secrets never leave the device", () => {
  it("exportGap strips bot token, webhook, owners, remote control and connector tokens", () => {
    const text = exportGap(gap());
    for (const s of SECRETS) expect(text).not.toContain(s);

    const agent = JSON.parse(text).gap.agents[0];
    const ch = agent.channels[0];
    expect(ch.remoteControl).toBe(false);
    expect(ch.owners).toBeUndefined();
    expect(ch.status).toBe("inactive");
    // The recipient still sees what to set up.
    expect(ch.kind).toBe("telegram");
    expect(ch.config).toEqual({ trigger: "mention" });
    expect(agent.connectors[0]).toMatchObject({ provider: "github", status: "disconnected" });
    expect(agent.connectors[0].scopes).toBeUndefined();
  });

  it("collectBackup strips the same from forge.gaps", () => {
    localStorage.setItem("forge.gaps", gapsBlob(gap()));
    const data = collectBackup();
    for (const s of SECRETS) expect(data["forge.gaps"]).not.toContain(s);
    expect(JSON.parse(data["forge.gaps"]).state.gaps[0].agents[0].channels[0].remoteControl).toBe(false);
  });

  it("applyBackup restores this device's channel and connector secrets onto matching ids", () => {
    localStorage.setItem("forge.gaps", gapsBlob(gap()));
    const backup = collectBackup();

    applyBackup(backup);

    const agent = JSON.parse(localStorage.getItem("forge.gaps")!).state.gaps[0].agents[0];
    const ch = agent.channels[0];
    expect(ch.token).toBe("123:BOT-TOKEN");
    expect(ch.remoteControl).toBe(true);
    expect(ch.owners[0].id).toBe("owner-42");
    expect(ch.config.webhook).toBe("https://discord.com/api/webhooks/1/abc");
    expect(agent.connectors[0]).toMatchObject({ scopes: ["ghp_CONNECTOR"], status: "connected" });
  });

  it("applyBackup does not hand this device's secrets to entries it doesn't have", () => {
    localStorage.setItem("forge.gaps", gapsBlob(gap()));
    const other = gap();
    other.agents[0].id = "someone-else";
    const backup = { "forge.gaps": gapsBlob(other) };

    applyBackup(backup);

    const stored = localStorage.getItem("forge.gaps")!;
    for (const s of SECRETS) expect(stored).not.toContain(s);
  });
});
