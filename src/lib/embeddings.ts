/**
 * Local semantic embeddings via transformers.js (BGE small v1.5, 384-dim). Runs fully
 * in-process — no embedding API, no key. The model is lazy-loaded on first use
 * and cached.
 *
 * A passage is embedded once, ever: its vector is kept in memory for the
 * session and saved in this device's IndexedDB under a SHA-256 of the model
 * and text, so after a restart a document is not re-processed. Queries are
 * not saved: they rarely repeat.
 *
 * Everything here degrades gracefully: if the model can't load (offline first
 * run, etc.) callers fall back to keyword retrieval.
 */

import { logger } from "./log";

const MODEL = "Xenova/bge-small-en-v1.5";
/** BGE retrieves best when the query (not the passage) carries this instruction. */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// Type-only: the library itself stays a lazy chunk.
type Extractor = Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline<"feature-extraction">>>;

let extractorPromise: Promise<Extractor | null> | null = null;
let available = true;

async function getExtractor(): Promise<Extractor | null> {
  if (!available) return null;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Allow remote model download; cache in browser storage.
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL);
    })().catch((e) => {
      logger("embeddings").warn("unavailable, falling back to keyword search", { error: e });
      available = false;
      return null;
    });
  }
  return extractorPromise;
}

/** Is the embedding backend usable (or at least not known-broken)? */
export function embeddingsAvailable(): boolean {
  return available;
}

/**
 * Keyed by the exact text: the old 32-bit hash key returned another chunk's
 * vector on a collision, silently corrupting retrieval. Capped, oldest out
 * (a Map iterates in insertion order), so a long session can't grow it forever.
 */
const cache = new Map<string, Float32Array>();
const CACHE_MAX = 4000;

/* ----------------------- Saved vectors (this device) ---------------------- */

/** Where passage vectors are kept between sessions. Swappable for tests. */
export interface VectorStore {
  get(key: string): Promise<Float32Array | undefined>;
  put(key: string, vec: Float32Array): void;
}

const DB_NAME = "forge.vectors";
const DB_STORE = "v";
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** IndexedDB, not localStorage: thousands of 1.5 KB vectors would blow its ~5 MB cap. */
const indexedDbStore: VectorStore = {
  async get(key) {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result instanceof Float32Array ? req.result : undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  },
  put(key, vec) {
    void openDb().then((db) => {
      try {
        db?.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(vec, key);
      } catch {
        // Quota or a closed database: the vector is simply recomputed next time.
      }
    });
  },
};

let store: VectorStore = indexedDbStore;

/** A collision-safe key: the model is part of it, so a model change never reuses old vectors. */
async function keyFor(input: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${MODEL}\n${input}`));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Tests only: swap the saved-vector store and forget this session's memory, like a restart. */
export function __setVectorStoreForTests(next: VectorStore | null): void {
  store = next ?? indexedDbStore;
  cache.clear();
  available = true;
  extractorPromise = null;
}

export async function embed(text: string, kind: "passage" | "query" = "passage"): Promise<Float32Array | null> {
  const input = kind === "query" ? QUERY_PREFIX + text : text;
  const hit = cache.get(input);
  if (hit) {
    cache.delete(input);
    cache.set(input, hit);
    return hit;
  }
  // Processed in an earlier session? Use the saved vector instead of running the model.
  const key = kind === "passage" ? await keyFor(input) : null;
  if (key) {
    const saved = await store.get(key).catch(() => undefined);
    if (saved) {
      remember(input, saved);
      return saved;
    }
  }
  const extractor = await getExtractor();
  if (!extractor) return null;
  let vec: Float32Array;
  try {
    // BGE is trained on the CLS token, not a mean over all tokens.
    const out = await extractor(input, { pooling: "cls", normalize: true });
    vec = Float32Array.from(out.data as Float32Array);
  } catch (e) {
    // A model that loads but can't run (bad runtime, OOM) must not fail the
    // agent's reply: switch to keyword search for the rest of the session.
    logger("embeddings").warn("failed, falling back to keyword search", { error: e });
    available = false;
    return null;
  }
  remember(input, vec);
  if (key) store.put(key, vec);
  return vec;
}

function remember(input: string, vec: Float32Array): void {
  cache.set(input, vec);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized
}
