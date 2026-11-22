import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { __setVectorStoreForTests, embed, type VectorStore } from "@/lib/embeddings";
import { prepareDoc, retrieveAsync } from "@/lib/knowledge";

// A stand-in for the local model that counts how often it actually runs.
const runs = vi.hoisted(() => ({ count: 0 }));
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async () => async (text: string) => {
    runs.count++;
    // A tiny deterministic "embedding": letter frequencies, normalised.
    const v = new Float32Array(26);
    for (const ch of text.toLowerCase()) {
      const i = ch.charCodeAt(0) - 97;
      if (i >= 0 && i < 26) v[i]++;
    }
    const n = Math.hypot(...v) || 1;
    return { data: v.map((x) => x / n) };
  },
}));

/** This device's saved vectors, as a Map. */
function savedVectors() {
  const saved = new Map<string, Float32Array>();
  const store: VectorStore = {
    get: async (k) => saved.get(k),
    put: (k, v) => void saved.set(k, v),
  };
  return { saved, store };
}

const doc = (content: string) => ({ id: "d", title: "Guide", content, bytes: content.length, addedAt: 0 });

beforeEach(() => {
  runs.count = 0;
});
afterAll(() => __setVectorStoreForTests(null));

describe("documents are processed once, ever", () => {
  it("a passage's vector is saved and reused after a restart instead of recomputed", async () => {
    const { saved, store } = savedVectors();
    __setVectorStoreForTests(store);
    await embed("refund policy: thirty days");
    expect(runs.count).toBe(1);
    expect(saved.size).toBe(1);

    // Restart: this session's memory is gone, the saved vectors are not.
    __setVectorStoreForTests(store);
    await embed("refund policy: thirty days");
    expect(runs.count).toBe(0 + 1); // still the single original run
  });

  it("adding a document prepares every passage up front, so the first question doesn't wait", async () => {
    const { saved, store } = savedVectors();
    __setVectorStoreForTests(store);
    await prepareDoc(
      "Refunds within thirty days.\n\nShipping takes five days.\n\n" + "Warranty covers one year. ".repeat(30),
    );
    const prepared = runs.count;
    expect(prepared).toBeGreaterThanOrEqual(2);

    // A later session asks a question: only the question itself is embedded.
    __setVectorStoreForTests(store);
    runs.count = 0;
    const context = await retrieveAsync(
      [doc("Refunds within thirty days.\n\nShipping takes five days.\n\n" + "Warranty covers one year. ".repeat(30))],
      "how long do refunds take",
    );
    expect(runs.count).toBe(1);
    expect(context).toContain("Refunds within thirty days");
    expect(saved.size).toBe(prepared); // questions aren't saved
  });
});
