import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Card, CardHeader, Badge, EmptyState, Modal, Field, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { usePublished } from "@/stores/published";
import { downloadGap, encodeShareCode } from "@/lib/gapfile";
import { useDialog } from "@/components/Confirm";

export function GapDetailView() {
  const { confirm, notify } = useDialog();
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
      <PageBody>
        <EmptyState icon="grid" title="GAP not found" action={<Button onClick={() => navigate("/gaps")}>Back to GAPs</Button>} />
      </PageBody>
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
        title={gap.name}
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

      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar emoji={gap.emoji} size={36} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{gap.source}</Badge>
            <Badge>v{gap.version}</Badge>
            <Badge>by {gap.author}</Badge>
            {gap.tags.map((t) => (
              <Badge key={t}>#{t}</Badge>
            ))}
          </div>
          <Link to={`/workshop/${gap.id}`} className="ml-auto text-xs text-ink-3 hover:text-ink">
            Edit in Workshop
          </Link>
        </div>

        <Card className="p-0">
          <div className="px-5 pt-4">
            <CardHeader title="Agents in this GAP" hint={`${gap.agents.length} total`} />
          </div>
          {gap.agents.length === 0 ? (
            <div className="border-t border-border">
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
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {gap.agents.map((a) => (
                <li key={a.id}>
                  <Link to={`/agents/${a.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50">
                    <Avatar emoji={a.emoji} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{a.name}</div>
                      <div className="truncate text-xs text-ink-3">{a.role}</div>
                    </div>
                    <span className="flex w-20 items-center justify-end gap-1.5 text-xs capitalize text-ink-2">
                      <StatusDot status={a.status} />
                      {a.status}
                    </span>
                    <Icon name="chevron" size={14} className="text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-danger/25">
          <CardHeader title="Danger zone" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-ink-2">Uninstall this GAP and all its agents. This can't be undone.</div>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (await confirm({ title: `Delete "${gap.name}"?`, body: `This GAP and its ${gap.agents.length} agent(s), with their chats and knowledge, are deleted.` })) {
                  deleteGap(gap.id);
                  navigate("/gaps");
                }
              }}
            >
              Delete GAP
            </Button>
          </div>
        </Card>
      </PageBody>

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
          <p className="text-[13px] text-ink-2">
            Hand this GAP to anyone — they import it from the GAPs tab. Export a file, or copy a share code.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" icon="download" onClick={async () => {
              try {
                await downloadGap(gap);
              } catch (e) {
                notify("Export failed", (e as Error).message);
              }
            }}>
              Export .gap file
            </Button>
            <Button
              className="flex-1"
              icon="copy"
              onClick={() => {
                void navigator.clipboard.writeText(encodeShareCode(gap));
                notify("Share code copied", "Paste it into another Forge install to import this pack.");
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
