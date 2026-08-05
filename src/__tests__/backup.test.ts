import { describe, it, expect, beforeEach } from "vitest";
import { collectBackup, applyBackup } from "@/lib/backup";

beforeEach(() => localStorage.clear());

describe("backup export/restore", () => {
  it("never puts credentials in an exported backup", () => {
    localStorage.setItem("forge.gaps", '{"state":{"gaps":[]}}');
    localStorage.setItem("forge.secret.apiKey", "sk-ant-should-not-leak");
    localStorage.setItem("forge.secret.ccToken", "cc-should-not-leak");

    const data = collectBackup();

    expect(data).toHaveProperty("forge.gaps");
    expect(JSON.stringify(data)).not.toContain("sk-ant-should-not-leak");
    expect(JSON.stringify(data)).not.toContain("cc-should-not-leak");
  });

  it("ignores keys that aren't Forge's", () => {
    localStorage.setItem("forge.runs", "[]");
    localStorage.setItem("someone-elses-key", "nope");

    expect(Object.keys(collectBackup())).toEqual(["forge.runs"]);
  });

  it("keeps the stored API key when restoring a backup", () => {
    localStorage.setItem("forge.secret.apiKey", "sk-ant-keep-me");
    localStorage.setItem("forge.gaps", "old");

    applyBackup({ "forge.gaps": "new" });

    expect(localStorage.getItem("forge.gaps")).toBe("new");
    expect(localStorage.getItem("forge.secret.apiKey")).toBe("sk-ant-keep-me");
  });

  it("refuses to restore a credential smuggled into a backup file", () => {
    applyBackup({ "forge.secret.apiKey": "sk-ant-injected", "forge.gaps": "x" });

    expect(localStorage.getItem("forge.secret.apiKey")).toBeNull();
    expect(localStorage.getItem("forge.gaps")).toBe("x");
  });

  it("clears stale Forge data that the backup does not contain", () => {
    localStorage.setItem("forge.runs", "stale");
    applyBackup({ "forge.gaps": "x" });

    expect(localStorage.getItem("forge.runs")).toBeNull();
  });
});
