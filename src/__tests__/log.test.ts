import { describe, it, expect, beforeEach } from "vitest";
import { clearLogs, exportLogs, logEntries, logger, redact, redactText } from "@/lib/log";

describe("log redaction", () => {
  it("masks secrets by key name, whatever the value looks like", () => {
    const out = redact({ apiKey: "abc", token: "x", scopes: ["ghp_x"], nested: { Authorization: "y" }, ok: 1 });
    expect(out).toEqual({
      apiKey: "[redacted]",
      token: "[redacted]",
      scopes: "[redacted]",
      nested: { Authorization: "[redacted]" },
      ok: 1,
    });
  });

  it("masks secret-shaped values inside free text", () => {
    const text = [
      "key sk-ant-api03-abcdefghijklmnop",
      "tg 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ",
      "slack xoxb-1234567890-abcdefghij",
      "gh ghp_abcdefghijklmnopqrstuvwxyz",
      "header Bearer eyJhbGciOiJIUzI1NiJ9.payload",
    ].join("\n");
    const out = redactText(text);
    for (const secret of ["sk-ant-api03", "AAHdqTcv", "xoxb-1234", "ghp_abc", "eyJhbGci"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("turns errors into plain data and caps long strings", () => {
    expect(redact(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
    expect(String(redact("x".repeat(5000))).length).toBeLessThan(2100);
  });

  it("survives cycles by bounding depth", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
  });
});

describe("logger", () => {
  beforeEach(() => clearLogs());

  it("records scoped, redacted entries and exports them as JSON lines", () => {
    const log = logger("test");
    log.info("hello", { token: "secret-value", n: 1 });
    log.error("failed", { error: new Error("nope") });
    const entries = logEntries();
    expect(entries.map((e) => [e.level, e.scope, e.msg])).toEqual([
      ["info", "test", "hello"],
      ["error", "test", "failed"],
    ]);
    expect(entries[0].data).toEqual({ token: "[redacted]", n: 1 });
    const lines = exportLogs().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).data.error.message).toBe("nope");
    expect(exportLogs()).not.toContain("secret-value");
  });

  it("keeps a bounded ring buffer", () => {
    const log = logger("flood");
    for (let i = 0; i < 1200; i++) log.info(`m${i}`);
    expect(logEntries().length).toBe(500);
    expect(logEntries()[logEntries().length - 1].msg).toBe("m1199");
  });
});
