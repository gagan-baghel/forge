import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Button, Badge, Card, EmptyState, Modal, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { parseGapFile, decodeShareCode } from "@/lib/gapfile";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

const COLORS = ["#6688FF", "#34C77C", "#EAB308", "#EF5350", "#FF8A4C", "#8B8B96"];
const EMOJIS = ["📦", "🔬", "⚒️", "🎧", "✍️", "📈", "🤖", "🚀", "🧠", "💡"];

export function GapsView() {
  const { notify } = useDialog();
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
      notify("Import failed", err.message);
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
                  notify("Invalid share code", e.message);
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

      <PageBody>
        {gaps.length === 0 ? (
          <Card>
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
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gaps.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/gaps/${g.id}`)}
                className="card flex flex-col p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-2/40"
              >
                <div className="flex items-start gap-3">
                  <Avatar emoji={g.emoji} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.color }} />
                      <h3 className="truncate text-[13px] font-semibold">{g.name}</h3>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{g.description || "No description"}</p>
                  </div>
                  <Badge tone={g.source === "local" ? "neutral" : "brand"}>{g.source}</Badge>
                </div>
                <div className="mt-4 flex items-center justify-between text-[11px] text-ink-3">
                  <span className="flex items-center gap-1.5">
                    <Icon name="agents" size={12} />
                    {g.agents.length} agent{g.agents.length === 1 ? "" : "s"}
                  </span>
                  <span>Updated {relativeTime(g.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </PageBody>

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
                    aria-label={`Icon ${e}`}
                    aria-pressed={emoji === e}
                    className={`grid h-8 w-8 place-items-center rounded-md border text-[15px] transition-colors ${
                      emoji === e ? "border-ink-3 bg-surface-3" : "border-border hover:bg-surface-2"
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
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-surface ${color === c ? "ring-2 ring-ink-2" : ""}`}
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
