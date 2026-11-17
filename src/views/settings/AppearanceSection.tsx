import clsx from "clsx";
import { Card, CardHeader, Field } from "@/components/ui";
import { useSettings } from "@/stores/settings";
import type { ThemeName } from "@/types/domain";

const THEMES: { id: ThemeName; label: string }[] = [
  { id: "dusk", label: "Dark" },
  { id: "paper", label: "Light" },
  { id: "system", label: "System" },
];

/** A tiny preview chip of each theme's surface. */
function ThemeSwatch({ theme }: { theme: ThemeName }) {
  const dark = "linear-gradient(135deg, #11100e 0 100%)";
  const light = "linear-gradient(135deg, #f6f3ed 0 100%)";
  const bg =
    theme === "dusk" ? dark : theme === "paper" ? light : "linear-gradient(135deg, #f6f3ed 0 50%, #11100e 50% 100%)";
  return (
    <span aria-hidden className="h-4 w-4 shrink-0 rounded border border-border-strong" style={{ background: bg }} />
  );
}

export function AppearanceSection() {
  const s = useSettings();
  return (
    <Card>
      <CardHeader title="Appearance" />
      <div className="space-y-4">
        <Field label="Theme">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={s.theme === t.id}
                onClick={() => s.setTheme(t.id)}
                className={clsx(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                  s.theme === t.id
                    ? "border-border-strong bg-surface-2 text-ink"
                    : "border-border text-ink-2 hover:bg-surface-2/50",
                )}
              >
                <ThemeSwatch theme={t.id} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Display name">
          <input
            className="input"
            value={s.userName}
            placeholder="Your name"
            onChange={(e) => s.setUserName(e.target.value)}
          />
        </Field>
      </div>
    </Card>
  );
}
