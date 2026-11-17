/** Sibling pages shown as tabs in the page header. */
export const TABS = {
  packs: [
    { label: "My packs", to: "/gaps" },
    { label: "Marketplace", to: "/marketplace" },
  ],
  knowledge: [
    { label: "Documents", to: "/knowledge" },
    { label: "Memory", to: "/memory" },
  ],
  activity: [
    { label: "Runs", to: "/runs" },
    { label: "Insights", to: "/observability" },
  ],
} satisfies Record<string, { label: string; to: string }[]>;
