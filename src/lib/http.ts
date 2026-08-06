/**
 * HTTP helper for tools and connectors. On desktop it routes through the Rust
 * `http_fetch` command (no browser CORS wall); on web it falls back to `fetch`
 * (subject to CORS — fine for permissive APIs like GitHub).
 */
import { invoke, isDesktop } from "./platform";

export interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
}

export async function httpFetch(opts: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  const method = opts.method ?? "GET";
  if (isDesktop()) {
    return invoke<HttpResult>("http_fetch", {
      method,
      url: opts.url,
      headers: opts.headers ?? {},
      body: opts.body ?? null,
    });
  }
  const res = await fetch(opts.url, { method, headers: opts.headers, body: opts.body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text };
}
