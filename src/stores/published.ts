import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Gap, MarketplaceListing } from "@/types/domain";

/**
 * GAPs the user has published. Local-first: "publishing" lists the GAP in your
 * own Marketplace and produces a shareable `.gap`/share-code. There's no central
 * registry — sharing is done by file or code, which others import.
 */
interface PublishedStore {
  listings: MarketplaceListing[];
  publish: (gap: Gap, meta?: { category?: string }) => void;
  unpublish: (slug: string) => void;
  isPublished: (slug: string) => boolean;
}

export const usePublished = create<PublishedStore>()(
  persist(
    (set, get) => ({
      listings: [],
      publish: (gap, meta) => {
        const { installed: _i, source: _s, ...rest } = gap;
        const listing: MarketplaceListing = {
          gap: { ...rest } as MarketplaceListing["gap"],
          featured: false,
          installs: 0,
          rating: 0,
          category: meta?.category ?? "Yours",
        };
        set((s) => ({ listings: [listing, ...s.listings.filter((l) => l.gap.slug !== gap.slug)] }));
      },
      unpublish: (slug) => set((s) => ({ listings: s.listings.filter((l) => l.gap.slug !== slug) })),
      isPublished: (slug) => get().listings.some((l) => l.gap.slug === slug),
    }),
    { name: "forge.published" },
  ),
);
