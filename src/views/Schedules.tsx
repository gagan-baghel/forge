import { useState } from "react";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useRoutines } from "@/stores/routines";
import { useGaps } from "@/stores/gaps";
import { runRoutineNow } from "@/lib/scheduler";
import { isValidCron, nextRun } from "@/lib/cron";
import { relativeTime } from "@/lib/format";
import type { Routine } from "@/types/domain";
import { useDialog } from "@/components/Confirm";

const PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily 9am", cron: "0 9 * * *" },
  { label: "Weekdays 8am", cron: "0 8 * * 1-5" },
  { label: "Weekly Mon", cron: "0 9 * * 1" },
];

export function SchedulesView() {
  const { confirm } = useDialog();
  const routines = useRoutines((s) => s.routines);
  const add = useRoutines((s) => s.add);
  const update = useRoutines((s) => s.update);
  const remove = useRoutines((s) => s.remove);
  const toggle = useRoutines((s) => s.toggle);
  const gaps = useGaps((s) => s.gaps);
  const agents = gaps.flatMap((g) => g.agents);

  const [open, setOpen] = useState(false);
  /** Routine being edited, or null when the modal creates a new one. */
  const [editing, setEditing] = useState<Routine | null>(null);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [cron, setCron] = useState(PRESETS[1].cron);
  const [prompt, setPrompt] = useState("");
  const [firing, setFiring] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setAgentId(agents[0]?.id ?? "");
    setCron(PRESETS[1].cron);
    setPrompt("");
    setOpen(true);
  };

  const openEdit = (r: Routine) => {
    setEditing(r);
    setName(r.name);
    setAgentId(r.agentId);
    setCron(r.cron);
    setPrompt(r.prompt);
    setOpen(true);
  };

  const save = () => {
    const agent = agents.find((a) => a.id === agentId);
    if (!name.trim() || !agent || !isValidCron(cron)) return;
    if (editing) {
      update(editing.id, {
        name: name.trim(),
        agentId: agent.id,
        agentName: agent.name,
        cron,
        prompt,
        nextRunAt: nextRun(cron, new Date()),
      });
    } else {
      add({ name: name.trim(), agentId: agent.id, agentName: agent.name, cron, prompt, enabled: true, nextRunAt: nextRun(cron, new Date()) });
    }
    setOpen(false);
  };

  const runNow = async (r: Routine) => {
    setFiring(r.id);
    try {
      await runRoutineNow(r.id);
    } finally {
      setFiring(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Schedules"
        subtitle="Run agents automatically on a recurring cadence"
        actions={
          <Button variant="primary" icon="plus" onClick={openCreate} disabled={agents.length === 0}>
            New routine
          </Button>
        }
      />
      <PageBody className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="phone" size={13} className="shrink-0" />
          Results also go to your paired phone — and approvals are asked there — when the agent has remote control on.
        </p>
        <Card className="p-0">
          {routines.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No routines"
              body={agents.length === 0 ? "Create an agent first, then schedule it." : "Schedule an agent to run a prompt on a cron cadence."}
              action={
                agents.length > 0 && (
                  <Button variant="primary" icon="plus" onClick={openCreate}>
                    New routine
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {routines.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/50">
                  <button
                    role="switch"
                    aria-checked={r.enabled}
                    onClick={() => toggle(r.id)}
                    className={clsx(
                      "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
                      r.enabled ? "border-brand bg-brand" : "border-border-strong bg-surface-3",
                    )}
                    aria-label={r.enabled ? "Pause routine" : "Resume routine"}
                  >
                    <span
                      className={clsx(
                        "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                        r.enabled ? "translate-x-[18px]" : "translate-x-0.5",
                      )}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{r.name}</span>
                      {!r.enabled && <Badge>paused</Badge>}
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {r.agentName} · <code className="font-mono text-[11px] text-ink-2">{r.cron}</code>
                      {" · "}
                      {r.lastRunAt ? `last ${relativeTime(r.lastRunAt)}` : "never ran"}
                      {r.enabled && r.nextRunAt ? ` · next ${relativeTime(r.nextRunAt)}` : ""}
                    </div>
                  </div>
                  <Button icon="play" disabled={firing === r.id} onClick={() => void runNow(r)}>
                    {firing === r.id ? "Running…" : "Run now"}
                  </Button>
                  <button className="btn-ghost h-7 px-1.5 text-ink-3 hover:text-ink" onClick={() => openEdit(r)} aria-label="Edit routine">
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    className="btn-ghost h-7 px-1.5 text-ink-3 hover:text-danger"
                    onClick={async () => {
                      if (await confirm({ title: `Delete routine "${r.name}"?`, body: "The schedule stops running immediately." })) remove(r.id);
                    }}
                    aria-label="Delete routine"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit routine" : "New routine"}>
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" autoFocus value={name} placeholder="Morning briefing" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Agent">
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Schedule"
            hint={isValidCron(cron) ? undefined : "Not a valid cron expression: five fields — minute hour day month weekday."}
          >
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  onClick={() => setCron(p.cron)}
                  aria-pressed={cron === p.cron}
                  className={clsx("chip h-6 px-2 transition-colors", cron === p.cron ? "border-border-strong bg-surface-3 text-ink" : "hover:text-ink")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              className="input font-mono"
              value={cron}
              aria-invalid={!isValidCron(cron)}
              onChange={(e) => setCron(e.target.value)}
            />
          </Field>
          <Field label="Prompt">
            <textarea className="input min-h-[90px] resize-y" value={prompt} placeholder="What should the agent do each run?" onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || !isValidCron(cron)}>
              {editing ? "Save changes" : "Create routine"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
