import { useState } from "react";
import clsx from "clsx";
import { Button, Field, Modal } from "./ui";
import { Icon } from "./Icon";
import { useGaps } from "@/stores/gaps";
import { useMemory } from "@/stores/memory";
import { extractText, KNOWLEDGE_ACCEPT, ExtractError } from "@/lib/extractText";

/** Which agent gets the item: fixed when opened from an agent, picked otherwise. */
function AgentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const gaps = useGaps((s) => s.gaps);
  return (
    <Field label="Agent">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {gaps.map((g) => (
          <optgroup key={g.id} label={g.name}>
            {g.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.role}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

function useFirstAgentId(fixed?: string) {
  const first = useGaps((s) => s.gaps.flatMap((g) => g.agents)[0]?.id ?? "");
  return fixed ?? first;
}

/* ------------------------------- Documents ------------------------------- */

/**
 * Add documents to an agent: drop or pick files (PDF, text, Markdown, CSV,
 * JSON…), or paste text. Everything is read locally.
 */
export function AddDocumentButton({ agentId, label = "Add document" }: { agentId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const hasAgents = useGaps((s) => s.gaps.some((g) => g.agents.length > 0));
  return (
    <>
      <Button variant="primary" icon="plus" disabled={!hasAgents} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AddDocumentDialog agentId={agentId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddDocumentDialog({ agentId, onClose }: { agentId?: string; onClose: () => void }) {
  const addKnowledge = useGaps((s) => s.addKnowledge);
  const [target, setTarget] = useState(useFirstAgentId(agentId));
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
        {!agentId && <AgentPicker value={target} onChange={setTarget} />}

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
          <p role="alert" className="whitespace-pre-line rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 text-[11px] text-ink-3">
          <span className="h-px flex-1 bg-border" /> or paste text <span className="h-px flex-1 bg-border" />
        </div>
        <Field label="Title">
          <input className="input" value={title} placeholder="Refund policy" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Text">
          <textarea className="input min-h-[120px] resize-y" value={content} placeholder="Paste anything the agent should know…" onChange={(e) => setContent(e.target.value)} />
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
export function AddMemoryButton({ agentId, label = "Add memory" }: { agentId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const hasAgents = useGaps((s) => s.gaps.some((g) => g.agents.length > 0));
  return (
    <>
      <Button variant="primary" icon="plus" disabled={!hasAgents} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AddMemoryDialog agentId={agentId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddMemoryDialog({ agentId, onClose }: { agentId?: string; onClose: () => void }) {
  const remember = useMemory((s) => s.remember);
  const [target, setTarget] = useState(useFirstAgentId(agentId));
  const [text, setText] = useState("");
  const save = () => {
    if (!text.trim() || !target) return;
    // Written by you, so it's kept as-is — no approval step.
    remember(target, text);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add memory">
      <div className="space-y-4">
        {!agentId && <AgentPicker value={target} onChange={setTarget} />}
        <Field label="What should the agent remember?" hint="A short fact, preference or decision. The agent sees the relevant ones before every answer.">
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
