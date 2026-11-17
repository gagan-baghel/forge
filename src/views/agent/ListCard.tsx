import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui";

export const ROW = "flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50";
export const ICON_BTN = "btn-ghost h-7 w-7 shrink-0 px-0 text-ink-3 hover:text-danger";

/** A card holding an edge-to-edge list, with a header and an empty line. */
export function ListCard({
  title,
  hint,
  action,
  empty,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-0">
      <div className="px-5 pt-4">
        <CardHeader title={title} hint={hint} action={action} />
      </div>
      {empty ? (
        <p className="border-t border-border px-5 py-6 text-center text-xs text-ink-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">{children}</ul>
      )}
    </Card>
  );
}
