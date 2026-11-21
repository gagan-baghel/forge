import { useState, type ComponentType } from "react";
import { BotFace } from "@/components/BotFace";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useGaps } from "@/stores/gaps";
import type { Agent } from "@/types/domain";
import { Button, EmptyState, StatusDot, Tabs } from "@/components/ui";
import { PageBody } from "@/components/Shell";
import { Icon } from "@/components/Icon";
import { Chat } from "./agent/Chat";
import { ConfigTab } from "./agent/ConfigTab";
import { SkillsTab } from "./agent/SkillsTab";
import { KnowledgeTab } from "./agent/KnowledgeTab";
import { LogsTab } from "./agent/LogsTab";

/**
 * One tab per question: talk to it, how it's set up, what it can do (built-in
 * skills and connected services together), what it knows (documents and
 * memory), and what it has done. Reaching it from a phone lives on the Remote
 * page, with every other agent's — the header links there.
 */
type Tab = "chat" | "config" | "skills" | "knowledge" | "logs";
/** Adding a tab is one entry here plus its component in ./agent. */
const TABS: { id: Tab; label: string; icon: string; Body: ComponentType<{ agent: Agent }> }[] = [
  { id: "chat", label: "Chat", icon: "message", Body: Chat },
  { id: "config", label: "Setup", icon: "settings", Body: ConfigTab },
  { id: "skills", label: "Skills", icon: "bolt", Body: SkillsTab },
  { id: "knowledge", label: "Knowledge", icon: "book", Body: KnowledgeTab },
  { id: "logs", label: "Activity", icon: "activity", Body: LogsTab },
];

export function AgentDetailView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // Two selectors, each returning a stable store object (a combined
  // { gap, agent } would be a new object every render).
  const agent = useGaps((s) => s.findAgent(id)?.agent);
  const gap = useGaps((s) => s.findAgent(id)?.gap);
  const updateAgent = useGaps((s) => s.updateAgent);
  const [tab, setTab] = useState<Tab>("chat");

  if (!agent || !gap) {
    return (
      <PageBody>
        <EmptyState
          icon="agents"
          title="Agent not found"
          action={<Button onClick={() => navigate("/agents")}>Back to agents</Button>}
        />
      </PageBody>
    );
  }
  const bots = agent.channels.filter((c) => (c.kind === "telegram" || c.kind === "discord") && c.token).length;
  const tabs = TABS.map(({ Body: _, ...t }) =>
    t.id === "skills" ? { ...t, count: agent.skills.length + agent.connectors.length } : t,
  );
  const Body = TABS.find((t) => t.id === tab)!.Body;
  const paused = agent.status === "paused";

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-bg/85 px-6 backdrop-blur" data-tauri-drag-region>
        <div className="flex min-h-[56px] items-center gap-3 py-3">
          <Link to="/agents" className="btn-ghost h-7 w-7 px-0" aria-label="Back to agents" title="Agents">
            <Icon name="chevron" size={16} className="rotate-180" />
          </Link>
          <BotFace name={agent.name} size={34} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{agent.name}</h1>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
              <span className="truncate">{agent.role}</span>
              <span>·</span>
              <Link to={`/gaps/${gap.id}`} className="truncate hover:text-ink">
                {gap.name}
              </Link>
            </div>
          </div>
          <Link
            to={`/remote?agent=${agent.id}`}
            className="btn-outline gap-2"
            title={
              bots ? "Reachable from your phone — manage on the Remote page" : "Set up phone access on the Remote page"
            }
          >
            <Icon name="phone" size={14} className={bots ? "text-success" : "text-ink-3"} />
            {bots ? "On your phone" : "Add to phone"}
          </Link>
          <button
            role="switch"
            aria-checked={!paused}
            onClick={() => updateAgent(agent.id, { status: paused ? "active" : "paused" })}
            title={
              paused
                ? "Paused: schedules don't run and phone messages are declined"
                : "Active: runs its schedules and answers your phone"
            }
            className="btn-outline gap-2"
          >
            <StatusDot status={agent.status} pulse={!paused && bots > 0} />
            {paused ? "Paused" : "Active"}
          </button>
        </div>
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="-mb-px" />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "chat" ? (
          <Body agent={agent} />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-8 py-6">
              <Body agent={agent} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
