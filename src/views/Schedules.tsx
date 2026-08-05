import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Badge, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useRoutines } from "@/stores/routines";
import { useGaps } from "@/stores/gaps";
import { runRoutineNow } from "@/lib/scheduler";
import { nextRun } from "@/lib/cron";
import { relativeTime } from "@/lib/format";
import type { Routine } from "@/types/domain";

const PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily 9am", cron: "0 9 * * *" },
  { label: "Weekdays 8am", cron: "0 8 * * 1-5" },
  { label: "Weekly Mon", cron: "0 9 * * 1" },
];

export function SchedulesView() {
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
    if (!name.trim() || !agent) return;
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
      <div className="p-7">
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
          <Card className="p-0">
            <div className="divide-y divide-border">
              {routines.map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                  <button
                    onClick={() => toggle(r.id)}
                    className={`h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors ${r.enabled ? "bg-success" : "bg-surface-2"}`}
                    aria-label={r.enabled ? "Pause routine" : "Resume routine"}
                  >
                    <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${r.enabled ? "translate-x-4" : ""}`} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-ink-3">
                      {r.agentName} · <code className="font-mono">{r.cron}</code>
                      {" · "}
                      {r.lastRunAt ? `last ${relativeTime(r.lastRunAt)}` : "never ran"}
                      {r.enabled && r.nextRunAt ? ` · next ${relativeTime(r.nextRunAt)}` : ""}
                    </div>
                  </div>
                  <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "active" : "paused"}</Badge>
                  <Button icon="bolt" disabled={firing === r.id} onClick={() => void runNow(r)}>
                    {firing === r.id ? "Running…" : "Run now"}
                  </Button>
                  <button className="btn-ghost p-1.5 text-ink-3 hover:text-ink" onClick={() => openEdit(r)} aria-label="Edit routine">
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="btn-ghost p-1.5 text-ink-3 hover:text-danger"
                    onClick={() => confirm(`Delete routine "${r.name}"?`) && remove(r.id)}
                    aria-label="Delete routine"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit routine" : "New routine"}>
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" autoFocus value={name} placeholder="Morning briefing" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Agent">
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Schedule">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.cron} onClick={() => setCron(p.cron)} className={`chip ${cron === p.cron ? "border-brand bg-brand/10 text-brand-2" : ""}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <input className="input font-mono" value={cron} onChange={(e) => setCron(e.target.value)} />
          </Field>
          <Field label="Prompt">
            <textarea className="input min-h-[90px] resize-y" value={prompt} placeholder="What should the agent do each run?" onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim()}>
              {editing ? "Save changes" : "Create routine"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
