import { describe, it, expect, beforeEach } from "vitest";
import { collectBackup, applyBackup } from "@/lib/backup";

const settings = (extra: Record<string, unknown>) => JSON.stringify({ state: { theme: "dusk", ...extra }, version: 0 });
const packs = (...names: string[]) =>
  JSON.stringify({ state: { gaps: names.map((name) => ({ id: name, name, agents: [{ id: "a", name: "A" }] })) } });
const packNames = () => JSON.parse(localStorage.getItem("forge.gaps")!).state.gaps.map((g: { name: string }) => g.name);

beforeEach(() => localStorage.clear());

describe("backup export/restore", () => {
  it("never puts credentials in an exported backup", () => {
    localStorage.setItem("forge.gaps", '{"state":{"gaps":[]}}');
    localStorage.setItem(
      "forge.settings",
      settings({ apiKey: "sk-ant-should-not-leak", ccToken: "cc-should-not-leak" }),
    );

    const data = collectBackup();

    expect(data).toHaveProperty("forge.gaps");
    expect(JSON.stringify(data)).not.toContain("sk-ant-should-not-leak");
    expect(JSON.stringify(data)).not.toContain("cc-should-not-leak");
    // Everything else in settings still travels.
    expect(JSON.parse(data["forge.settings"]).state.theme).toBe("dusk");
  });

  it("drops a settings blob it cannot parse rather than risk exporting a key", () => {
    localStorage.setItem("forge.settings", "{not json");
    expect(collectBackup()).not.toHaveProperty("forge.settings");
  });

  it("ignores keys that aren't Forge's", () => {
    localStorage.setItem("forge.runs", "[]");
    localStorage.setItem("someone-elses-key", "nope");

    expect(Object.keys(collectBackup())).toEqual(["forge.runs"]);
  });

  it("keeps this device's credentials when restoring a backup", () => {
    localStorage.setItem("forge.settings", settings({ apiKey: "sk-ant-keep-me" }));
    localStorage.setItem("forge.gaps", packs("old"));

    applyBackup({ "forge.gaps": packs("new"), "forge.settings": settings({ theme: "paper" }) });

    expect(packNames()).toEqual(["new"]);
    const after = JSON.parse(localStorage.getItem("forge.settings")!).state;
    expect(after.apiKey).toBe("sk-ant-keep-me");
    expect(after.theme).toBe("paper");
  });

  it("refuses to restore a credential smuggled into a backup file", () => {
    applyBackup({ "forge.settings": settings({ apiKey: "sk-ant-injected" }), "forge.gaps": packs("x") });

    expect(JSON.parse(localStorage.getItem("forge.settings")!).state.apiKey).toBeUndefined();
    expect(packNames()).toEqual(["x"]);
  });

  it("clears stale Forge data that the backup does not contain", () => {
    localStorage.setItem("forge.runs", "stale");
    applyBackup({ "forge.gaps": packs("x") });

    expect(localStorage.getItem("forge.runs")).toBeNull();
  });

  it("rejects a corrupt backup without touching the data already here", () => {
    localStorage.setItem("forge.gaps", packs("mine"));
    localStorage.setItem("forge.runs", "[1]");

    expect(() => applyBackup({ "forge.gaps": "{not json" })).toThrow(/corrupt/);
    expect(() => applyBackup({ "forge.gaps": packs("ok").replace('"agents":[', '"agents":"oops","x":[') })).toThrow(
      /agents/,
    );
    expect(() => applyBackup("nope")).toThrow(/Not a Forge backup/);

    expect(packNames()).toEqual(["mine"]);
    expect(localStorage.getItem("forge.runs")).toBe("[1]");
  });

  it("fills defaults on old packs and never writes keys that aren't Forge's", () => {
    applyBackup({ "forge.gaps": packs("old"), "evil.key": "x" });

    const agent = JSON.parse(localStorage.getItem("forge.gaps")!).state.gaps[0].agents[0];
    expect(agent).toMatchObject({ skills: [], knowledge: [], connectors: [], channels: [], status: "active" });
    expect(localStorage.getItem("evil.key")).toBeNull();
  });
});
