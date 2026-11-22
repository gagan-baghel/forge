import { useState } from "react";
import clsx from "clsx";
import { Button, Field, Modal } from "./ui";
import { Icon } from "./Icon";
import { useGaps } from "@/stores/gaps";
import { useMemory, type MemoryOwner } from "@/stores/memory";
import { extractText, KNOWLEDGE_ACCEPT, ExtractError } from "@/lib/extractText";
import { prepareDoc } from "@/lib/knowledge";

/**
 * Who gets the item, encoded as `pack:<id>` (shared by every agent in the
 * pack) or `agent:<id>` (that agent only). Fixed when opened from a pack or an
 * agent; picked otherwise.
 */
type Target = string;
const parseTarget = (t: Target): MemoryOwner | undefined =>
  t.startsWith("pack:") ? { gapId: t.slice(5) } : t.startsWith("agent:") ? { agentId: t.slice(6) } : undefined;

function TargetPicker({ value, onChange }: { value: Target; onChange: (t: Target) => void }) {
  const gaps = useGaps((s) => s.gaps);
  return (
    <Field
      label="Who it's for"
      hint="Pack items are shared by every agent in the pack; agent items stay with that agent."
    >
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {gaps.map((g) => (
          <optgroup key={g.id} label={g.name}>
            <option value={`pack:${g.id}`}>Whole pack — shared with all {g.agents.length} agents</option>
            {g.agents.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name} only — {a.role}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

function useInitialTarget(agentId?: string, gapId?: string): Target {
  const first = useGaps((s) => s.gaps[0]?.id ?? "");
  if (agentId) return `agent:${agentId}`;
  return `pack:${gapId ?? first}`;
}

/* ------------------------------- Documents ------------------------------- */

/**
 * Add documents to an agent: drop or pick files (PDF, text, Markdown, CSV,
 * JSON…), or paste text. Everything is read locally.
 */
export function AddDocumentButton({
  agentId,
  gapId,
  label = "Add document",
}: {
  agentId?: string;
  gapId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasPacks = useGaps((s) => s.gaps.length > 0);
  return (
    <>
      <Button variant="primary" icon="plus" disabled={!hasPacks} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AddDocumentDialog agentId={agentId} gapId={gapId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddDocumentDialog({ agentId, gapId, onClose }: { agentId?: string; gapId?: string; onClose: () => void }) {
  const addAgentDoc = useGaps((s) => s.addKnowledge);
  const addPackDoc = useGaps((s) => s.addPackKnowledge);
  const [target, setTarget] = useState(useInitialTarget(agentId, gapId));
  const addKnowledge = (t: Target, doc: Parameters<typeof addAgentDoc>[1]) => {
    // Read once, now: its passages are processed and saved in the background.
    void prepareDoc(doc.content);
    const o = parseTarget(t);
    if (o && "gapId" in o) addPackDoc(o.gapId, doc);
    else if (o) addAgentDoc(o.agentId, doc);
  };
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!files.length || !target) return;
    setBusy(true);
    setError("");
    const failed: string[] = [];
    for (const file of files) {
      try {
        const text = await extractText(file);
        addKnowledge(target, { title: file.name, content: text, bytes: text.length, source: "upload" });
      } catch (e) {
        failed.push(e instanceof ExtractError ? e.message : `Couldn't read "${file.name}".`);
      }
    }
    setBusy(false);
    if (failed.length) setError(failed.join("\n"));
    else onClose();
  };

  const addPasted = () => {
    if (!title.trim() || !content.trim() || !target) return;
    addKnowledge(target, { title: title.trim(), content: content.trim(), bytes: content.trim().length });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Add document" width={560}>
      <div className="space-y-4">
        {!agentId && !gapId && <TargetPicker value={target} onChange={setTarget} />}

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles([...e.dataTransfer.files]);
          }}
          className={clsx(
            "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center transition-colors",
            drag ? "border-brand bg-brand/5" : "border-border-strong hover:border-ink-3",
          )}
        >
          <Icon name="upload" size={18} className="text-ink-3" />
          <span className="text-[13.5px] font-medium">{busy ? "Reading…" : "Drop files here, or click to choose"}</span>
          <span className="font-mono text-[10.5px] text-ink-3">PDF · TXT · MD · CSV · JSON · HTML</span>
          <input
            type="file"
            multiple
            hidden
            accept={KNOWLEDGE_ACCEPT}
            disabled={busy}
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="whitespace-pre-line rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 text-[11px] text-ink-3">
          <span className="h-px flex-1 bg-border" /> or paste text <span className="h-px flex-1 bg-border" />
        </div>
        <Field label="Title">
          <input
            className="input"
            value={title}
            placeholder="Refund policy"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Text">
          <textarea
            className="input min-h-[120px] resize-y"
            value={content}
            placeholder="Paste anything the agent should know…"
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={addPasted} disabled={!title.trim() || !content.trim() || !target}>
            Add text
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- Memories ------------------------------- */

/** Write a memory by hand: a fact the agent should always keep in mind. */
export function AddMemoryButton({
  agentId,
  gapId,
  label = "Add memory",
}: {
  agentId?: string;
  gapId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasPacks = useGaps((s) => s.gaps.length > 0);
  return (
    <>
      <Button variant="primary" icon="plus" disabled={!hasPacks} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AddMemoryDialog agentId={agentId} gapId={gapId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddMemoryDialog({ agentId, gapId, onClose }: { agentId?: string; gapId?: string; onClose: () => void }) {
  const remember = useMemory((s) => s.remember);
  const [target, setTarget] = useState(useInitialTarget(agentId, gapId));
  const [text, setText] = useState("");
  const save = () => {
    const owner = parseTarget(target);
    if (!text.trim() || !owner) return;
    // Written by you, so it's kept as-is — no approval step.
    remember(owner, text);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add memory">
      <div className="space-y-4">
        {!agentId && !gapId && <TargetPicker value={target} onChange={setTarget} />}
        <Field
          label="What should the agent remember?"
          hint="A short fact, preference or decision. The agent sees the relevant ones before every answer."
        >
          <textarea
            className="input min-h-[90px] resize-y"
            autoFocus
            value={text}
            placeholder="I prefer answers in bullet points, with sources."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!text.trim() || !target}>
            Remember
          </Button>
        </div>
      </div>
    </Modal>
  );
}
