import { describe, it, expect, beforeEach } from "vitest";
import { collectBackup, applyBackup } from "@/lib/backup";

const settings = (extra: Record<string, unknown>) =>
  JSON.stringify({ state: { theme: "dusk", ...extra }, version: 0 });

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
    localStorage.setItem("forge.gaps", "old");

    applyBackup({ "forge.gaps": "new", "forge.settings": settings({ theme: "paper" }) });

    expect(localStorage.getItem("forge.gaps")).toBe("new");
    const after = JSON.parse(localStorage.getItem("forge.settings")!).state;
    expect(after.apiKey).toBe("sk-ant-keep-me");
    expect(after.theme).toBe("paper");
  });

  it("refuses to restore a credential smuggled into a backup file", () => {
    applyBackup({ "forge.settings": settings({ apiKey: "sk-ant-injected" }), "forge.gaps": "x" });

    expect(JSON.parse(localStorage.getItem("forge.settings")!).state.apiKey).toBeUndefined();
    expect(localStorage.getItem("forge.gaps")).toBe("x");
  });

  it("clears stale Forge data that the backup does not contain", () => {
    localStorage.setItem("forge.runs", "stale");
    applyBackup({ "forge.gaps": "x" });

    expect(localStorage.getItem("forge.runs")).toBeNull();
  });
});
