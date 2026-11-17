import { Card, CardHeader } from "@/components/ui";
import { useSettings } from "@/stores/settings";
import { MODELS } from "@/types/domain";

export function PricingSection() {
  const s = useSettings();
  return (
    <Card className="p-0">
      <div className="px-5 pt-4">
        <CardHeader title="Price overrides" hint="USD per million tokens. Used for cost estimates in runs and chats." />
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {MODELS.map((m) => {
          const price = s.priceOverrides[m.id] ?? m.price;
          return (
            <li key={m.id} className="flex items-center gap-3 px-5 py-2">
              <span className="flex-1 text-[13px]">{m.label}</span>
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                in
                <input
                  type="number"
                  step={0.1}
                  className="input w-20 font-mono"
                  value={price.in}
                  onChange={(e) => s.setPriceOverride(m.id, { ...price, in: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                out
                <input
                  type="number"
                  step={0.1}
                  className="input w-20 font-mono"
                  value={price.out}
                  onChange={(e) => s.setPriceOverride(m.id, { ...price, out: Number(e.target.value) })}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
