import clsx from "clsx";
import { Card, CardHeader, Field } from "@/components/ui";
import { useGaps } from "@/stores/gaps";
import type { Gap } from "@/types/domain";

const COLORS = ["#D9703A", "#C49A3C", "#7FA36B", "#6B8FA8", "#A8738F", "#B5654F"];

export function IdentitySection({ gap }: { gap: Gap }) {
  const updateGap = useGaps((s) => s.updateGap);
  return (
    <Card className="space-y-4">
      <CardHeader title="Details" hint="How this pack appears in lists, the Marketplace and exported files." />
      <div className="grid grid-cols-1 gap-4">
        <Field label="Name">
          <input className="input" value={gap.name} onChange={(e) => updateGap(gap.id, { name: e.target.value })} />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className="input min-h-[70px] resize-y"
          value={gap.description}
          onChange={(e) => updateGap(gap.id, { description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Version" hint="Bump when you share a new revision.">
          <input
            className="input"
            value={gap.version}
            onChange={(e) => updateGap(gap.id, { version: e.target.value })}
          />
        </Field>
        <Field label="Author">
          <input className="input" value={gap.author} onChange={(e) => updateGap(gap.id, { author: e.target.value })} />
        </Field>
      </div>
      <Field label="Tags" hint="Comma-separated.">
        <input
          className="input"
          value={gap.tags.join(", ")}
          onChange={(e) =>
            updateGap(gap.id, {
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2 pt-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateGap(gap.id, { color: c })}
              aria-pressed={gap.color === c}
              className={clsx(
                "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface",
                gap.color === c && "ring-2 ring-ink-2",
              )}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
    </Card>
  );
}
