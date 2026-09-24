import { PageBody, PageHeader } from "@/components/Shell";
import { Card, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";

// Only providers an agent can actually attach in its Connections tab, and that
// ship a real tool in lib/tools.ts. Listing more advertises a dead end.
const PROVIDERS = [
  { id: "slack", name: "Slack", blurb: "Post messages to a channel" },
  { id: "github", name: "GitHub", blurb: "Call the GitHub REST API" },
  { id: "notion", name: "Notion", blurb: "Search pages and databases" },
];

export function IntegrationsView() {
  const gaps = useGaps((s) => s.gaps);
  const allConnectors = gaps.flatMap((g) => g.agents.flatMap((a) => a.connectors));
  const connected = new Set(allConnectors.map((c) => c.provider));

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connectors available to your agents" />
      <PageBody className="space-y-3">
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {PROVIDERS.map((p) => {
              const isOn = connected.has(p.id as any);
              const count = allConnectors.filter((c) => c.provider === p.id).length;
              return (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-ink-2">
                    <Icon name="plug" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{p.name}</div>
                    <div className="truncate text-xs text-ink-3">{p.blurb}</div>
                  </div>
                  {isOn ? (
                    <Badge tone="success">
                      {count} agent{count === 1 ? "" : "s"}
                    </Badge>
                  ) : (
                    <span className="text-xs text-ink-3">Not connected</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="info" size={13} />
          Connectors are attached per-agent in the agent's Connections tab.
        </p>
      </PageBody>
    </div>
  );
}
