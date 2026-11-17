/**
 * Local structured logging. Every entry is redacted before it is stored, kept
 * in a ring buffer on this device (survives a restart, never sent anywhere),
 * and echoed to the dev console. Settings → Data exports it for a bug report.
 *
 *   const log = logger("channels");
 *   log.warn("send failed", { chatId, error });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = import.meta.env.DEV ? "debug" : "info";
const MAX_ENTRIES = 500;
const MAX_STRING = 2000;
const PERSIST_DEBOUNCE_MS = 1000;
/** Not "forge." — that prefix is what backups collect, and logs don't belong in one. */
const STORAGE_KEY = "forge-log";

/* ------------------------------- Redaction ------------------------------- */

/** Keys whose values are secrets whatever they look like. */
const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|scopes/i;

/** Values that are secrets wherever they appear. */
const SECRET_VALUES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic keys and OAuth tokens
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot tokens
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(ghp|gho|ghs|github_pat|secret|ntn)_[A-Za-z0-9_]{10,}/g, // GitHub, Notion
  /\b[MNO][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}\b/g, // Discord bot tokens
  /(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{8,}/gi, // auth headers
];

const MASK = "[redacted]";

export function redactText(text: string): string {
  let out = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  for (const re of SECRET_VALUES) out = out.replace(re, MASK);
  return out;
}

/** A JSON-safe, secret-free copy of `value`. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (depth > 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? MASK : redact(v, depth + 1);
    return out;
  }
  return String(value);
}

/* --------------------------------- Store --------------------------------- */

let entries: LogEntry[] = load();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]).slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

/** Debounced so a burst of entries costs one storage write, not one each. */
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or unavailable: the in-memory buffer still works.
    }
  }, PERSIST_DEBOUNCE_MS);
}

const CONSOLE: Record<LogLevel, (...a: unknown[]) => void> = {
  // eslint-disable-next-line no-console -- the dev echo is the point
  debug: (...a) => console.debug(...a),
  // eslint-disable-next-line no-console -- the dev echo is the point
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

function write(level: LogLevel, scope: string, msg: string, data?: Record<string, unknown>) {
  if (RANK[level] < RANK[MIN_LEVEL]) return;
  const entry: LogEntry = { ts: Date.now(), level, scope, msg: redactText(msg) };
  if (data) entry.data = redact(data) as Record<string, unknown>;
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  if (import.meta.env.DEV || RANK[level] >= RANK.warn) {
    CONSOLE[level](`[${scope}] ${entry.msg}`, ...(entry.data ? [entry.data] : []));
  }
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** A logger for one area of the app; `scope` tags every entry it writes. */
export function logger(scope: string): Logger {
  return {
    debug: (m, d) => write("debug", scope, m, d),
    info: (m, d) => write("info", scope, m, d),
    warn: (m, d) => write("warn", scope, m, d),
    error: (m, d) => write("error", scope, m, d),
  };
}

export function logEntries(): readonly LogEntry[] {
  return entries;
}

/** One JSON object per line, ready to attach to a bug report. */
export function exportLogs(): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

export function clearLogs(): void {
  entries = [];
  persist();
}

/**
 * Last line of defence: anything thrown outside React (a timer, a promise no
 * one awaited) lands in the log instead of vanishing. Installed once at boot.
 */
export function installGlobalErrorHandlers(): void {
  const log = logger("app");
  window.addEventListener("error", (e) => log.error("uncaught error", { message: e.message, source: e.filename }));
  window.addEventListener("unhandledrejection", (e) => log.error("unhandled rejection", { reason: e.reason }));
}
