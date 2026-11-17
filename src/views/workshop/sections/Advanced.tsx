import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, CardHeader } from "@/components/ui";
import { useDialog } from "@/hooks/useDialog";
import { useGaps } from "@/stores/gaps";
import { encodeShareCode } from "@/lib/gapfile";
import { errorMessage } from "@/lib/runError";
import type { Gap } from "@/types/domain";
import { useExportGap } from "../useExportGap";

export function AdvancedSection({ gap }: { gap: Gap }) {
  const { confirm, notify } = useDialog();
  const updateGap = useGaps((s) => s.updateGap);
  const deleteGap = useGaps((s) => s.deleteGap);
  const navigate = useNavigate();
  const exportGap = useExportGap();

  const pretty = useMemo(() => JSON.stringify(gap, null, 2), [gap]);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState("");
  const dirty = text !== pretty;

  const save = () => {
    setError("");
    try {
      const parsed = JSON.parse(text) as Gap;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The manifest must be a JSON object.");
      }
      if (!Array.isArray(parsed.agents)) throw new Error("`agents` must be an array.");
      // The id is the store key — it can't be renamed here. Agents always
      // belong to this pack regardless of what the buffer says.
      updateGap(gap.id, {
        ...parsed,
        id: gap.id,
        agents: parsed.agents.map((a) => ({ ...a, gapId: gap.id })),
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <Card className="space-y-3">
        <CardHeader
          title="Raw manifest"
          hint="The whole pack as JSON — the escape hatch for anything the form doesn't surface. Saving replaces the pack."
          action={
            dirty && (
              <Button variant="primary" icon="check" onClick={save}>
                Save manifest
              </Button>
            )
          }
        />
        <textarea
          className="input min-h-[340px] resize-y font-mono text-xs leading-relaxed"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <div className="text-xs text-danger">{error}</div>}
        {dirty && (
          <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setText(pretty)}>
            Discard buffer and reload from the pack
          </button>
        )}
      </Card>

      <Card>
        <CardHeader title="Share" hint="Hand this pack to anyone as a file or a share code." />
        <div className="flex gap-2">
          <Button className="flex-1" icon="download" onClick={() => exportGap(gap)}>
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
      </Card>

      <Card className="border-danger/25">
        <CardHeader title="Danger zone" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-ink-2">Delete this pack and all its agents. This can't be undone.</div>
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (
                await confirm({
                  title: `Delete "${gap.name}"?`,
                  body: `This pack and its ${gap.agents.length} agent(s), with their chats and knowledge, are deleted.`,
                })
              ) {
                deleteGap(gap.id);
                navigate("/workshop");
              }
            }}
          >
            Delete GAP
          </Button>
        </div>
      </Card>
    </>
  );
}
