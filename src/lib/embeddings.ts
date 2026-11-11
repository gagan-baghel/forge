/**
 * Local semantic embeddings via transformers.js (BGE small v1.5, 384-dim). Runs fully
 * in-process — no embedding API, no key. The model is lazy-loaded on first use
 * and cached. Chunk embeddings are memoized so repeated retrieval is cheap.
 *
 * Everything here degrades gracefully: if the model can't load (offline first
 * run, etc.) callers fall back to keyword retrieval.
 */

const MODEL = "Xenova/bge-small-en-v1.5";
/** BGE retrieves best when the query (not the passage) carries this instruction. */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractorPromise: Promise<any> | null = null;
let available = true;

async function getExtractor(): Promise<any | null> {
  if (!available) return null;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Allow remote model download; cache in browser storage.
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL);
    })().catch((e) => {
      console.warn("Embeddings unavailable, falling back to keyword search:", e);
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

export async function embed(text: string, kind: "passage" | "query" = "passage"): Promise<Float32Array | null> {
  const input = kind === "query" ? QUERY_PREFIX + text : text;
  const hit = cache.get(input);
  if (hit) {
    cache.delete(input);
    cache.set(input, hit);
    return hit;
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
    console.warn("Embeddings failed, falling back to keyword search:", e);
    available = false;
    return null;
  }
  cache.set(input, vec);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return vec;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized
}
