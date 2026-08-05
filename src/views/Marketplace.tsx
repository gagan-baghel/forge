import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { marketplaceCatalog } from "@/lib/seed";
import { useGaps } from "@/stores/gaps";
import { usePublished } from "@/stores/published";
import { fmtNumber } from "@/lib/format";
import type { MarketplaceListing } from "@/types/domain";

export function MarketplaceView() {
  const baseCatalog = useMemo(() => marketplaceCatalog(), []);
  const publishedListings = usePublished((s) => s.listings);
  const catalog = useMemo(() => [...publishedListings, ...baseCatalog], [publishedListings, baseCatalog]);
  const gaps = useGaps((s) => s.gaps);
  const installListing = useGaps((s) => s.installListing);
  const navigate = useNavigate();
  const [cat, setCat] = useState<string>("All");
  const [q, setQ] = useState("");

  const categories = ["All", ...Array.from(new Set(catalog.map((l) => l.category)))];
  const installedSlugs = new Set(gaps.map((g) => g.slug));
  const filtered = catalog.filter((l) => {
    if (cat !== "All" && l.category !== cat) return false;
    const hay = (l.gap.name + l.gap.description + l.gap.tags.join(" ")).toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const install = (l: MarketplaceListing) => {
    const g = installListing(l);
    navigate(`/gaps/${g.id}`);
  };

  return (
    <div>
      <PageHeader title="Marketplace" subtitle="Discover and install GAPs built by the community" />
      <div className="space-y-6 p-7">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative mr-2 w-64">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-9" placeholder="Search packs…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`chip ${cat === c ? "border-brand bg-brand/10 text-brand-2" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => {
            const installed = installedSlugs.has(l.gap.slug);
            return (
              <Card key={l.gap.slug} className="flex flex-col">
                <div className="mb-3 flex items-start justify-between">
                  <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl" style={{ background: `${l.gap.color}22` }}>
                    {l.gap.emoji}
                  </div>
                  {l.featured && <Badge tone="brand">★ Featured</Badge>}
                </div>
                <h3 className="font-semibold">{l.gap.name}</h3>
                <p className="mt-1 flex-1 text-sm text-ink-2">{l.gap.description}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
                  <span className="flex items-center gap-1">
                    <Icon name="download" size={13} /> {fmtNumber(l.installs)}
                  </span>
                  <span>★ {l.rating}</span>
                  <span className="flex items-center gap-1">
                    <Icon name="agents" size={13} /> {l.gap.agents.length}
                  </span>
                </div>
                <div className="mt-4">
                  {installed ? (
                    <Button className="w-full" disabled icon="check">
                      Installed
                    </Button>
                  ) : (
                    <Button variant="primary" className="w-full" icon="download" onClick={() => install(l)}>
                      Install GAP
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
