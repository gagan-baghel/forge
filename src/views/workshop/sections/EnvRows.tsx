import { useState } from "react";
import { Button, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";

/** Key/value editor for env maps. Rows edit in place; blank keys are dropped on blur. */
export function EnvRows({
  label,
  hint,
  env,
  onChange,
}: {
  label: string;
  hint?: string;
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}) {
  // Local row state so keys can be edited without immediately re-keying the map.
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() => Object.entries(env).map(([k, v]) => ({ k, v })));

  const commit = (next: { k: string; v: string }[]) => {
    setRows(next);
    const out: Record<string, string> = {};
    for (const { k, v } of next) if (k.trim()) out[k.trim()] = v;
    onChange(out);
  };

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input w-2/5 font-mono"
              placeholder="KEY"
              value={row.k}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
            />
            <span className="text-ink-3">=</span>
            <input
              className="input flex-1 font-mono"
              placeholder="value"
              value={row.v}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
            />
            <button
              className="btn-ghost h-7 w-7 shrink-0 px-0 text-ink-3 hover:text-danger"
              aria-label={`Remove ${row.k || "variable"}`}
              onClick={() => commit(rows.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
        <Button icon="plus" onClick={() => setRows([...rows, { k: "", v: "" }])}>
          Add variable
        </Button>
      </div>
    </Field>
  );
}
