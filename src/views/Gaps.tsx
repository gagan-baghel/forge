import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Badge, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { parseGapFile, decodeShareCode } from "@/lib/gapfile";
import { relativeTime } from "@/lib/format";

const COLORS = ["#6D5BFF", "#40C98E", "#F0B446", "#F46060", "#4FA8FF", "#C46DFF"];
const EMOJIS = ["📦", "🔬", "⚒️", "🎧", "✍️", "📈", "🤖", "🚀", "🧠", "💡"];

export function GapsView() {
  const gaps = useGaps((s) => s.gaps);
  const createGap = useGaps((s) => s.createGap);
  const importGap = useGaps((s) => s.importGap);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);

  const create = () => {
    if (!name.trim()) return;
    const gap = createGap({ name: name.trim(), description: desc.trim(), emoji, color });
    setOpen(false);
    setName("");
    setDesc("");
    navigate(`/gaps/${gap.id}`);
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const gap = importGap(parseGapFile(await file.text()));
      navigate(`/gaps/${gap.id}`);
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHeader
        title="GAPs"
        subtitle="Global Agent Packs — installable bundles of agents, skills and knowledge"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".gap,.json" hidden onChange={onImport} />
            <Button
              icon="copy"
              onClick={() => {
                const code = prompt("Paste a Forge share code:");
                if (!code) return;
                try {
                  const gap = importGap(decodeShareCode(code));
                  navigate(`/gaps/${gap.id}`);
                } catch (e: any) {
                  alert(`Invalid share code: ${e.message}`);
                }
              }}
            >
              Paste code
            </Button>
            <Button icon="upload" onClick={() => fileRef.current?.click()}>
              Import file
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
              New GAP
            </Button>
          </>
        }
      />

      <div className="p-7">
        {gaps.length === 0 ? (
          <EmptyState
            icon="grid"
            title="No GAPs installed"
            body="A GAP bundles one or more agents with their skills and knowledge. Create one or install from the Marketplace."
            action={
              <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
                Create your first GAP
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {gaps.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/gaps/${g.id}`)}
                className="card group p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-soft"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-xl text-xl"
                    style={{ background: `${g.color}22` }}
                  >
                    {g.emoji}
                  </div>
                  <Badge tone={g.source === "local" ? "neutral" : "brand"}>{g.source}</Badge>
                </div>
                <h3 className="font-semibold">{g.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">{g.description || "No description"}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-ink-3">
                  <span className="flex items-center gap-1.5">
                    <Icon name="agents" size={14} />
                    {g.agents.length} agent{g.agents.length === 1 ? "" : "s"}
                  </span>
                  <span>{relativeTime(g.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New GAP">
        <div className="space-y-4">
          <Field label="Name">
            <input className="input" autoFocus value={name} placeholder="My agent pack" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea
              className="input min-h-[72px] resize-y"
              value={desc}
              placeholder="What does this pack do?"
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Icon">
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setEmoji(e)}
                    className={`grid h-9 w-9 place-items-center rounded-lg border text-lg ${
                      emoji === e ? "border-brand bg-brand/10" : "border-border"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Color">
              <div className="flex flex-wrap gap-2 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>
              Create GAP
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
