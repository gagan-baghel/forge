import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Card, Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";

export function ChannelsView() {
  const gaps = useGaps((s) => s.gaps);
  const rows = gaps.flatMap((g) =>
    g.agents.flatMap((a) => a.channels.map((c) => ({ channel: c, agent: a }))),
  );

  return (
    <div>
      <PageHeader title="Channels" subtitle="Messaging surfaces that front your agents" />
      <div className="p-7">
        {rows.length === 0 ? (
          <EmptyState
            icon="message"
            title="No channels configured"
            body="Open an agent's Channels tab to connect it to Telegram, Discord, Slack or the web."
          />
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-border">
              {rows.map(({ channel, agent }) => (
                <Link
                  key={`${agent.id}-${channel.id}`}
                  to={`/agents/${agent.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <Icon name="message" size={18} className="text-ink-3" />
                  <div className="flex-1">
                    <div className="text-sm font-medium capitalize">{channel.kind}</div>
                    <div className="text-xs text-ink-3">
                      {agent.emoji} {agent.name}
                    </div>
                  </div>
                  <Badge tone={channel.status === "active" ? "success" : "neutral"}>{channel.status}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
