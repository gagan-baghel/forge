import { Link, useNavigate, useParams } from "react-router-dom";
import { BotStack } from "@/components/BotFace";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { Button, EmptyState } from "@/components/ui";
import { PageBody } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { Chat } from "./agent/Chat";

/** Talking to a whole pack: its agents answer and hand work to each other. */
export function PackChatView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const gap = useGaps((s) => s.findGap(id));
  const running = useChannelRuntime((s) => s.running);

  if (!gap) {
    return (
      <PageBody>
        <EmptyState
          icon="grid"
          title="Pack not found"
          action={<Button onClick={() => navigate("/agents")}>Back to agents</Button>}
        />
      </PageBody>
    );
  }

  const onPhone = (gap.channels ?? []).some((c) => c.token && running[channelKey(gap.id, c.id)]);

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-border bg-bg/85 px-6 backdrop-blur" data-tauri-drag-region>
        <div className="flex min-h-[56px] items-center gap-3 py-3">
          <Link to="/agents" className="btn-ghost h-7 w-7 px-0" aria-label="Back to agents" title="Agents">
            <Icon name="chevron" size={16} className="rotate-180" />
          </Link>
          <BotStack agents={gap.agents} size={30} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{gap.name}</h1>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
              {gap.agents.map((a, i) => (
                <span key={a.id} className="flex items-center gap-1.5">
                  {i > 0 && <span>·</span>}
                  <Link to={`/agents/${a.id}`} className="hover:text-ink" title={`Chat with ${a.name} alone`}>
                    {a.name}
                  </Link>
                </span>
              ))}
            </div>
          </div>
          <Link
            to={`/remote?pack=${gap.id}`}
            className="btn-outline gap-2"
            title="Reach the whole pack from your phone — set up on the Remote page"
          >
            <Icon name="phone" size={14} className={onPhone ? "text-success" : "text-ink-3"} />
            {onPhone ? "On your phone" : "Add to phone"}
          </Link>
          <Link to={`/gaps/${gap.id}`} className="btn-outline gap-2" title="Agents, MCP servers, environment, sharing">
            <Icon name="settings" size={14} className="text-ink-3" />
            Pack settings
          </Link>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Chat key={gap.id} gap={gap} />
      </div>
    </div>
  );
}
