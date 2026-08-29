import { describe, it, expect } from "vitest";
import { classifyError, ERROR_LABELS } from "@/lib/runError";
import { TimeoutError } from "@/lib/claude";
import { InvalidPayload } from "@/lib/validate";

/** "12 failures" is not actionable; "9 rate limits, 3 timeouts" is. */
describe("failure classification", () => {
  it("recognises a user cancel, which is not a failure", () => {
    expect(classifyError(Object.assign(new Error("Stopped."), { name: "AbortError" }))).toBe("cancelled");
  });

  it("recognises our own timeouts, from both layers", () => {
    expect(classifyError(new TimeoutError("Claude did not respond within 60s."))).toBe("timeout");
    expect(classifyError(new Error("Claude Code sent nothing for 180s and was stopped."))).toBe("timeout");
    expect(classifyError(new Error("Claude stopped sending data for 120s."))).toBe("timeout");
  });

  it("separates rate limits from auth failures", () => {
    expect(classifyError(new Error("Claude API error 429: rate_limit_error"))).toBe("rate_limit");
    expect(classifyError(new Error("Claude API error 529: overloaded"))).toBe("rate_limit");
    expect(classifyError(new Error("API Error: 401 OAuth access token has expired"))).toBe("auth");
    expect(classifyError(new Error("No API key set."))).toBe("auth");
  });

  it("recognises network trouble", () => {
    expect(classifyError(new Error("Network error reaching Claude: fetch failed"))).toBe("network");
  });

  it("recognises a malformed model response", () => {
    expect(classifyError(new InvalidPayload("The model's design was not valid JSON."))).toBe("malformed");
  });

  it("falls back to other rather than throwing on junk", () => {
    expect(classifyError(undefined)).toBe("other");
    expect(classifyError("just a string")).toBe("other");
    expect(classifyError(null)).toBe("other");
  });

  it("has a label for every kind, so no chart row renders blank", () => {
    for (const k of ["timeout", "rate_limit", "auth", "network", "malformed", "cancelled", "other"] as const) {
      expect(ERROR_LABELS[k]).toBeTruthy();
    }
  });
});
