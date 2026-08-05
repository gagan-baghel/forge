import { PageHeader } from "@/components/Shell";
import { Card, Badge, Button } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";

const PROVIDERS = [
  { id: "slack", name: "Slack", blurb: "Post and read messages in channels" },
  { id: "github", name: "GitHub", blurb: "Read repos, issues and PRs" },
  { id: "gmail", name: "Gmail", blurb: "Read and draft email" },
  { id: "notion", name: "Notion", blurb: "Search and update pages" },
  { id: "linear", name: "Linear", blurb: "Create and triage issues" },
  { id: "google_drive", name: "Google Drive", blurb: "Read documents and files" },
];

export function IntegrationsView() {
  const gaps = useGaps((s) => s.gaps);
  const allConnectors = gaps.flatMap((g) => g.agents.flatMap((a) => a.connectors));
  const connected = new Set(allConnectors.map((c) => c.provider));

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connectors available to your agents" />
      <div className="p-7">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDERS.map((p) => {
            const isOn = connected.has(p.id as any);
            const count = allConnectors.filter((c) => c.provider === p.id).length;
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-ink-2">
                    <Icon name="plug" size={18} />
                  </div>
                  {isOn && <Badge tone="success">{count} agent{count === 1 ? "" : "s"}</Badge>}
                </div>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 flex-1 text-sm text-ink-2">{p.blurb}</p>
                <Button className="mt-4 w-full" disabled>
                  {isOn ? "Connected" : "Add from an agent"}
                </Button>
              </Card>
            );
          })}
        </div>
        <p className="mt-5 text-center text-xs text-ink-3">
          Connectors are attached per-agent in the agent's Connections tab.
        </p>
      </div>
    </div>
  );
}
