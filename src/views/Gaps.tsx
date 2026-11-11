import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PageBody, PageHeader, TABS } from "@/components/Shell";
import { Avatar, Button, Badge, Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import type { Gap } from "@/types/domain";
import { parseGapFile, decodeShareCode } from "@/lib/gapfile";
import { relativeTime } from "@/lib/format";
import { useDialog } from "@/components/Confirm";

export function GapsView() {
  const { notify } = useDialog();
  const gaps = useGaps((s) => s.gaps);
  const importGap = useGaps((s) => s.importGap);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);


  // Imported MCP servers arrive switched off; say so, or they look broken.
  const noteDisabledServers = (gap: Gap) => {
    const n = gap.mcpServers?.length ?? 0;
    if (n) notify("Review before enabling", `${n} MCP server${n === 1 ? "" : "s"} in this pack run commands on your Mac. They're off until you check and enable them in the pack editor.`);
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const gap = importGap(parseGapFile(await file.text()));
      noteDisabledServers(gap);
      navigate(`/gaps/${gap.id}`);
    } catch (err: any) {
      notify("Import failed", err.message);
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHeader
        title="Packs"
        tabs={TABS.packs}
        subtitle="Bundles of agents, skills and knowledge — each one a shareable .gap file"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".gap,.json" hidden onChange={onImport} />
            <Button
              variant="ghost"
              icon="copy"
              onClick={() => {
                const code = prompt("Paste a Forge share code:");
                if (!code) return;
                try {
                  const gap = importGap(decodeShareCode(code));
                  noteDisabledServers(gap);
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
            <Button icon="spark" onClick={() => navigate("/architect")}>
              Describe one
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("/workshop")}>
              New pack
            </Button>
          </>
        }
      />

      <PageBody>
        {gaps.length === 0 ? (
          <Card>
            <EmptyState
              icon="grid"
              title="No packs yet"
              body="A pack bundles agents with their skills and knowledge. Build one, describe one to the Architect, or install one from the Marketplace."
              action={
                <Button variant="primary" icon="plus" onClick={() => navigate("/workshop")}>
                  Build your first pack
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
                  <Avatar name={g.name} tint={g.color} size={32} />
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

    </div>
  );
}
