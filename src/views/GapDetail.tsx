import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, Modal, Field, StatusDot } from "@/components/ui";
import { useGaps } from "@/stores/gaps";
import { usePublished } from "@/stores/published";
import { downloadGap, encodeShareCode } from "@/lib/gapfile";

export function GapDetailView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const gap = useGaps((s) => s.findGap(id));
  const addAgent = useGaps((s) => s.addAgent);
  const deleteGap = useGaps((s) => s.deleteGap);
  const updateGap = useGaps((s) => s.updateGap);
  const publish = usePublished((s) => s.publish);
  const unpublish = usePublished((s) => s.unpublish);
  const published = usePublished((s) => (gap ? s.isPublished(gap.slug) : false));

  const [agentOpen, setAgentOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  if (!gap) {
    return (
      <div className="p-7">
        <EmptyState icon="grid" title="GAP not found" action={<Button onClick={() => navigate("/gaps")}>Back to GAPs</Button>} />
      </div>
    );
  }

  const create = () => {
    if (!name.trim()) return;
    const a = addAgent(gap.id, { name: name.trim(), role: role.trim() || "Assistant" });
    setAgentOpen(false);
    setName("");
    setRole("");
    navigate(`/agents/${a.id}`);
  };

  return (
    <div>
      <PageHeader
        title={`${gap.emoji}  ${gap.name}`}
        subtitle={gap.description}
        actions={
          <>
            <Button icon="upload" onClick={() => setShareOpen(true)}>
              Share
            </Button>
            {published ? (
              <Button icon="check" onClick={() => unpublish(gap.slug)}>
                Published
              </Button>
            ) : (
              <Button icon="store" onClick={() => publish(gap)}>
                Publish
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={() => setAgentOpen(true)}>
              Add agent
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-7">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="brand">{gap.source}</Badge>
          <Badge>v{gap.version}</Badge>
          <Badge>by {gap.author}</Badge>
          {gap.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Agents in this GAP</h2>
            <span className="text-xs text-ink-3">{gap.agents.length} total</span>
          </div>
          {gap.agents.length === 0 ? (
            <EmptyState
              icon="agents"
              title="No agents yet"
              body="Add an agent to this GAP to start building."
              action={
                <Button variant="primary" icon="plus" onClick={() => setAgentOpen(true)}>
                  Add agent
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {gap.agents.map((a) => (
                <Link
                  key={a.id}
                  to={`/agents/${a.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border p-3.5 transition-colors hover:border-brand/40 hover:bg-surface-2"
                >
                  <span className="text-2xl">{a.emoji}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-xs text-ink-3">{a.role}</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-ink-2">
                    <StatusDot status={a.status} />
                    {a.status}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Danger zone</h2>
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-2">Uninstall this GAP and all its agents. This can't be undone.</div>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm(`Delete "${gap.name}" and its ${gap.agents.length} agent(s)?`)) {
                  deleteGap(gap.id);
                  navigate("/gaps");
                }
              }}
            >
              Delete GAP
            </Button>
          </div>
        </Card>
      </div>

      <Modal open={agentOpen} onClose={() => setAgentOpen(false)} title="Add agent">
        <div className="space-y-4">
          <Field label="Agent name">
            <input className="input" autoFocus value={name} placeholder="Scout" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Role">
            <input className="input" value={role} placeholder="Research assistant" onChange={(e) => setRole(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAgentOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>
              Create agent
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title={`Share ${gap.name}`}>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            Hand this GAP to anyone — they import it from the GAPs tab. Export a file, or copy a share code.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" icon="download" onClick={() => downloadGap(gap)}>
              Export .gap file
            </Button>
            <Button
              className="flex-1"
              icon="copy"
              onClick={() => {
                void navigator.clipboard.writeText(encodeShareCode(gap));
                alert("Share code copied to clipboard.");
              }}
            >
              Copy share code
            </Button>
          </div>
          <Field label="Share code">
            <textarea readOnly className="input min-h-[90px] resize-none font-mono text-xs" value={encodeShareCode(gap)} />
          </Field>
        </div>
      </Modal>

      {/* Hidden hook to keep updateGap referenced for future inline rename. */}
      <button className="hidden" onClick={() => updateGap(gap.id, {})} />
    </div>
  );
}
