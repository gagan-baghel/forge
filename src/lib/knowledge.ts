/**
 * Lightweight, dependency-free knowledge retrieval. Forge keeps RAG local and
 * simple: documents are chunked, scored against the query with a TF-style
 * keyword overlap, and the top chunks are injected into the system prompt.
 *
 * This is intentionally model-free (no embeddings) so it works offline and in
 * the web build. It can be upgraded to embeddings later without touching callers.
 */

import type { KnowledgeDoc } from "@/types/domain";
import { cosine, embed, embeddingsAvailable } from "./embeddings";

const STOP = new Set(
  "the a an and or but of to in on for with is are was were be been it this that as at by from".split(" "),
);

/** Strip a simple trailing plural so "refunds" matches "refund". */
function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

function chunk(text: string, size = 600): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + p).length > size && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += p + "\n\n";
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Semantic retrieval using local embeddings, with automatic fallback to the
 * keyword scorer when the model isn't available. Returns a formatted context
 * string of the most relevant chunks, or "".
 */
export async function retrieveAsync(docs: KnowledgeDoc[], query: string, topK = 3): Promise<string> {
  if (!docs.length || !query.trim()) return "";
  if (!embeddingsAvailable()) return retrieve(docs, query, topK);

  const qVec = await embed(query);
  if (!qVec) return retrieve(docs, query, topK);

  const scored: { title: string; text: string; score: number }[] = [];
  for (const doc of docs) {
    for (const c of chunk(doc.content)) {
      const v = await embed(c);
      if (!v) continue;
      scored.push({ title: doc.title, text: c, score: cosine(qVec, v) });
    }
  }
  if (!scored.length) return retrieve(docs, query, topK);

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((s) => s.score > 0.15)
    .map((s) => `[${s.title}] ${s.text}`)
    .join("\n\n");
}

/** Return a formatted context string of the most relevant chunks, or "". */
export function retrieve(docs: KnowledgeDoc[], query: string, topK = 3): string {
  if (!docs.length) return "";
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return "";

  const scored: { title: string; text: string; score: number }[] = [];
  for (const doc of docs) {
    for (const c of chunk(doc.content)) {
      const tokens = tokenize(c);
      if (!tokens.length) continue;
      let hits = 0;
      for (const t of tokens) if (qTokens.has(t)) hits++;
      const score = hits / Math.sqrt(tokens.length);
      if (score > 0) scored.push({ title: doc.title, text: c, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => `[${s.title}] ${s.text}`)
    .join("\n\n");
}
