import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Icon } from "@/components/Icon";

/**
 * One owner's items inside a pack section: "Shared with the whole pack" or
 * "<Agent> only". The left rule and label make it obvious who reads what.
 */
export function OwnerBlock({
  label,
  href,
  shared,
  action,
  children,
}: {
  label: string;
  href: string;
  shared?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={clsx("border-l-2 pl-3", shared ? "border-brand/60" : "border-border")}>
      <div className="flex items-center gap-2 text-xs">
        <Icon name={shared ? "grid" : "agents"} size={12} className={shared ? "text-brand" : "text-ink-3"} />
        <Link to={href} className="font-medium text-ink-2 hover:text-ink">
          {label}
        </Link>
        <span className="ml-auto flex items-center gap-2">{action}</span>
      </div>
      {children}
    </div>
  );
}
