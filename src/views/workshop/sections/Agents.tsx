import { Link, useNavigate } from "react-router-dom";
import { BotFace } from "@/components/BotFace";
import { Button, Card, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { useGaps } from "@/stores/gaps";
import { MODELS, type Agent, type Gap } from "@/types/domain";

export function AgentsSection({ gap }: { gap: Gap }) {
  const addAgent = useGaps((s) => s.addAgent);
  const navigate = useNavigate();
  // Agents are edited on their own page; here they are only listed, added and
  // removed, so an agent never has two forms.
  const add = () => navigate(`/agents/${addAgent(gap.id, { name: "New agent", role: "Assistant" }).id}`);

  return gap.agents.length === 0 ? (
    <Card>
      <EmptyState
        icon="agents"
        title="No agents in this pack"
        action={
          <Button variant="primary" icon="plus" onClick={add}>
            Add agent
          </Button>
        }
      />
    </Card>
  ) : (
    <>
      <Card className="p-0">
        <ul className="divide-y divide-border">
          {gap.agents.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </ul>
      </Card>
      <Button icon="plus" onClick={add}>
        Add agent
      </Button>
    </>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const { confirm } = useDialog();
  const deleteAgent = useGaps((s) => s.deleteAgent);
  const model = MODELS.find((m) => m.id === agent.model)?.label ?? agent.model;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link to={`/agents/${agent.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <BotFace name={agent.name} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium group-hover:text-brand-2">{agent.name}</span>
          <span className="block truncate text-xs text-ink-3">
            {agent.role} · {agent.skills.length} skills · {agent.knowledge.length} docs
          </span>
        </span>
        <span className="hidden font-mono text-[11px] text-ink-2 sm:block">{model}</span>
        <span className="inline-flex w-16 items-center justify-end gap-1.5 font-mono text-[11px] text-ink-3">
          <StatusDot status={agent.status} />
          {agent.status}
        </span>
        <Icon name="chevron" size={14} className="text-ink-3" />
      </Link>
      <button
        className="btn-ghost h-7 w-7 shrink-0 px-0 text-ink-3 hover:text-danger"
        aria-label={`Remove ${agent.name}`}
        onClick={async () => {
          if (
            await confirm({
              title: `Remove ${agent.name}?`,
              body: "The agent, its chats and its documents are deleted.",
              confirmLabel: "Remove",
            })
          )
            deleteAgent(agent.id);
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}
