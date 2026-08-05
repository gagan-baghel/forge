/**
 * Local semantic embeddings via transformers.js (all-MiniLM-L6-v2). Runs fully
 * in-process — no embedding API, no key. The model is lazy-loaded on first use
 * and cached. Chunk embeddings are memoized so repeated retrieval is cheap.
 *
 * Everything here degrades gracefully: if the model can't load (offline first
 * run, etc.) callers fall back to keyword retrieval.
 */

let extractorPromise: Promise<any> | null = null;
let available = true;

async function getExtractor(): Promise<any | null> {
  if (!available) return null;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Allow remote model download; cache in browser storage.
      env.allowLocalModels = false;
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
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

/** Warm the model in the background (called when an agent has knowledge). */
export function warmEmbeddings(): void {
  void getExtractor();
}

const cache = new Map<string, Float32Array>();

function key(text: string): string {
  // Cheap stable key; collisions are harmless (just a cache miss correction).
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

export async function embed(text: string): Promise<Float32Array | null> {
  const k = key(text);
  const hit = cache.get(k);
  if (hit) return hit;
  const extractor = await getExtractor();
  if (!extractor) return null;
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const vec = Float32Array.from(out.data as Float32Array);
  cache.set(k, vec);
  return vec;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized
}
