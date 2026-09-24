import { useState } from "react";
import { PageBody, PageHeader } from "@/components/Shell";
import { Button, Card, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/components/Confirm";
import { useTeam, type Role } from "@/stores/team";
import { relativeTime } from "@/lib/format";

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export function TeamView() {
  const { confirm } = useDialog();
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
      <PageBody className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-xs text-ink-3">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          <span>
            Forge is local-first — there's no shared server. This roster helps you track collaborators; share GAPs with
            them via export or share code from any GAP's <span className="font-medium text-ink-2">Share</span> button.
          </span>
        </p>

        <Card className="p-0">
          {members.length === 0 ? (
            <EmptyState
              icon="user"
              title="No members yet"
              body="Add the people you collaborate with to keep your workspace organized."
              action={
                <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
                  Add member
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/50">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-xs font-medium text-ink-2">
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{m.name}</div>
                    <div className="truncate text-xs text-ink-3">
                      {m.email || "no email"} · added {relativeTime(m.addedAt)}
                    </div>
                  </div>
                  <select
                    className="input h-7 w-auto py-0 text-xs"
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    onChange={(e) => updateRole(m.id, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-ghost h-7 px-1.5 text-ink-3 hover:text-danger"
                    aria-label={`Remove ${m.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${m.name}?`, body: "They are removed from this workspace.", confirmLabel: "Remove" }))
                        remove(m.id);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>

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
