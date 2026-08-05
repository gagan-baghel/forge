import { describe, it, expect, vi } from "vitest";

// Force the keyword fallback so tests never load the embeddings model.
vi.mock("@/lib/embeddings", () => ({
  embeddingsAvailable: () => false,
  embed: async () => null,
  cosine: () => 0,
  warmEmbeddings: () => {},
}));

import { retrieve, retrieveAsync } from "@/lib/knowledge";
import type { KnowledgeDoc } from "@/types/domain";

const docs: KnowledgeDoc[] = [
  { id: "1", title: "Refunds", content: "Customers can request a refund within 30 days of purchase.", bytes: 60, addedAt: 0 },
  { id: "2", title: "Shipping", content: "Orders ship within two business days via standard courier.", bytes: 60, addedAt: 0 },
];

describe("knowledge retrieval", () => {
  it("returns the most relevant chunk by keyword", () => {
    const out = retrieve(docs, "how do refunds work");
    expect(out).toContain("Refunds");
    expect(out).not.toContain("Shipping");
  });

  it("returns empty for no docs or empty query", () => {
    expect(retrieve([], "anything")).toBe("");
    expect(retrieve(docs, "")).toBe("");
  });

  it("retrieveAsync falls back to keyword when embeddings are unavailable", async () => {
    const out = await retrieveAsync(docs, "when do orders arrive");
    expect(out).toContain("Shipping");
  });
});
