/**
 * Classify a run failure into something countable.
 *
 * The runs log stores an error's message, which is fine for one row and
 * useless in aggregate — every rate limit reads differently. A small closed
 * set turns "12 failures" into "9 rate limits and 3 timeouts", which is the
 * difference between knowing something broke and knowing what to do.
 */
export type ErrorKind =
  | "timeout"
  | "rate_limit"
  | "auth"
  | "network"
  | "malformed"
  | "cancelled"
  | "other";

export function classifyError(err: unknown): ErrorKind {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name ?? "";
  const msg = String(e?.message ?? err ?? "");

  if (name === "AbortError") return "cancelled";
  // Patterns match the exact strings our own timeout layers emit: the API
  // connect deadline, the SSE idle guard, and the Rust CLI watchdog.
  if (name === "TimeoutError" || /timed out|did not respond|stopped sending|sent nothing for/i.test(msg)) {
    return "timeout";
  }
  if (/\b429\b|rate limit|overloaded|\b529\b/i.test(msg)) return "rate_limit";
  if (/\b401\b|\b403\b|api key|authenticate|not signed in|expired/i.test(msg)) return "auth";
  if (/network|fetch failed|dns|offline|econn/i.test(msg)) return "network";
  if (/not valid json|did not contain|InvalidPayload|unexpected token/i.test(msg)) return "malformed";
  return "other";
}

/** Human label for the runs table and charts. */
export const ERROR_LABELS: Record<ErrorKind, string> = {
  timeout: "Timed out",
  rate_limit: "Rate limited",
  auth: "Auth failed",
  network: "Network",
  malformed: "Bad response",
  cancelled: "Cancelled",
  other: "Other",
};
