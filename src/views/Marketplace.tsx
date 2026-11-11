import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Avatar, Button, Card, Badge, EmptyState } from "@/components/ui";
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
      <PageHeader title="Packs" tabs={TABS.packs} subtitle="Ready-made packs to install and adapt" />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative mr-1 w-64">
            <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" placeholder="Search packs…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={clsx(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                cat === c ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card className="p-0">
            <EmptyState icon="store" title="No packs match" body="Try a different search or category." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((l) => {
              const installed = installedSlugs.has(l.gap.slug);
              return (
                <Card key={l.gap.slug} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={l.gap.name} tint={l.gap.color} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[13px] font-semibold">{l.gap.name}</h3>
                        {l.featured && <Badge tone="brand">Featured</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] tabular-nums text-ink-3">
                        <span className="flex items-center gap-1">
                          <Icon name="download" size={12} /> {fmtNumber(l.installs)}
                        </span>
                        <span>★ {l.rating}</span>
                        <span className="flex items-center gap-1">
                          <Icon name="agents" size={12} /> {l.gap.agents.length}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-3 flex-1 text-xs leading-relaxed text-ink-2">{l.gap.description}</p>
                  <div className="mt-4">
                    {installed ? (
                      <Button className="w-full" disabled icon="check">
                        Installed
                      </Button>
                    ) : (
                      <Button className="w-full" icon="download" onClick={() => install(l)}>
                        Install GAP
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
