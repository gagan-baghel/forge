import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useTeam, type Role } from "@/stores/team";
import { relativeTime } from "@/lib/format";

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export function TeamView() {
  const members = useTeam((s) => s.members);
  const add = useTeam((s) => s.add);
  const remove = useTeam((s) => s.remove);
  const updateRole = useTeam((s) => s.updateRole);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  const invite = () => {
    if (!name.trim()) return;
    add({ name: name.trim(), email: email.trim(), role });
    setOpen(false);
    setName("");
    setEmail("");
  };

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="A local roster for organizing who you build and share GAPs with"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
            Add member
          </Button>
        }
      />
      <div className="space-y-4 p-7">
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-ink-3">
          Forge is local-first — there's no shared server. This roster helps you track collaborators; share GAPs with
          them via export or share code from any GAP's <strong>Share</strong> button.
        </div>

        {members.length === 0 ? (
          <EmptyState
            icon="agents"
            title="No members yet"
            body="Add the people you collaborate with to keep your workspace organized."
            action={
              <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
                Add member
              </Button>
            }
          />
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-brand/15 text-sm font-semibold text-brand-2">
                    {m.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-ink-3">{m.email || "no email"} · added {relativeTime(m.addedAt)}</div>
                  </div>
                  <select
                    className="input w-auto"
                    value={m.role}
                    onChange={(e) => updateRole(m.id, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
                  <button className="btn-ghost p-1.5 text-ink-3 hover:text-danger" onClick={() => remove(m.id)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add member">
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" autoFocus value={name} placeholder="Grace Hopper" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" value={email} placeholder="grace@example.com" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={invite} disabled={!name.trim()}>
              Add
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
