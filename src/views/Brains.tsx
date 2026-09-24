import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, Badge, EmptyState, Modal, Field } from "@/components/ui";
import { useBrains } from "@/stores/brains";
import { useGaps } from "@/stores/gaps";
import { MODELS } from "@/types/domain";

/**
 * Brains — a neutral, workspace-level tab. A brain is a detachable mind
 * (persona + model preferences + knowledge + optional shared memory) that can
 * be attached to any agent, in any GAP, and moved between them freely.
 */
export function BrainsView() {
  const brains = useBrains((s) => s.brains);
  const createBrain = useBrains((s) => s.createBrain);
  const gaps = useGaps((s) => s.gaps);
  const agents = gaps.flatMap((g) => g.agents);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = () => {
    if (!name.trim()) return;
    const b = createBrain({ name: name.trim(), description: description.trim() });
    setOpen(false);
    setName("");
    setDescription("");
    navigate(`/brains/${b.id}`);
  };

  return (
    <div>
      <PageHeader
        title="Brains"
        subtitle="Detachable minds — persona, model preferences, knowledge and memory. Attach one to any agent."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
            New brain
          </Button>
        }
      />

      <PageBody>
        {brains.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon="brain"
              title="No brains yet"
              body="Create a brain once, then attach it to any agent. Detach and move it whenever you like — the agent keeps its own config underneath."
              action={
                <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
                  Create your first brain
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {brains.map((b) => {
              const wearing = agents.filter((a) => a.brainId === b.id);
              const model = MODELS.find((m) => m.id === b.model);
              return (
                <Link
                  key={b.id}
                  to={`/brains/${b.id}`}
                  className="card flex flex-col p-4 transition-colors hover:border-border-strong"
                >
                  <div className="flex items-start gap-3">
                    <Avatar emoji={b.emoji} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="truncate text-[13px] font-semibold">{b.name}</h3>
                        <span className="font-mono text-[11px] text-ink-3">v{b.version}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{b.description || "No description yet."}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Badge tone={wearing.length > 0 ? "brand" : "neutral"}>
                      {wearing.length === 0 ? "unattached" : `${wearing.length} agent${wearing.length === 1 ? "" : "s"}`}
                    </Badge>
                    {model && <Badge>{model.label}</Badge>}
                    {b.sharedMemory && <Badge tone="success">shared memory</Badge>}
                    {b.knowledge.length > 0 && <Badge>{b.knowledge.length} docs</Badge>}
                    {b.tags.map((t) => (
                      <Badge key={t}>#{t}</Badge>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </PageBody>

      <Modal open={open} onClose={() => setOpen(false)} title="New brain">
        <div className="space-y-4">
          <Field label="Name">
            <input
              className="input"
              autoFocus
              value={name}
              placeholder="Research mind"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </Field>
          <Field label="Description" hint="What this brain knows or how it thinks.">
            <input
              className="input"
              value={description}
              placeholder="Deep-research persona with company knowledge"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>
              Create brain
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
