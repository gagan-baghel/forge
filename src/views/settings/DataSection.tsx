import { useState, type ChangeEvent } from "react";
import { Button, Card, CardHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { collectBackup, applyBackup, BACKUP_MAGIC } from "@/lib/backup";
import { saveTextFile } from "@/lib/saveFile";
import { errorMessage } from "@/lib/runError";
import { exportLogs } from "@/lib/log";
import { discardPendingWrites } from "@/lib/persistStorage";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useRuns } from "@/stores/runs";

export function DataSection() {
  const { confirm } = useDialog();
  const [notice, setNotice] = useState("");

  const resetAll = async () => {
    const ok = await confirm({
      title: "Clear all my data?",
      body: "Every pack, agent, chat and run on this device is deleted, and your stored credentials are cleared. This cannot be undone.",
      confirmLabel: "Clear everything",
    });
    if (!ok) return;
    // clear() rather than removing the forge.* keys one by one: this is the
    // button people press to leave nothing behind, and a per-key sweep would
    // quietly spare the API key if a future key ever escapes the prefix.
    discardPendingWrites();
    localStorage.clear();
    location.reload();
  };

  const exportBackup = async () => {
    const payload = JSON.stringify({ magic: BACKUP_MAGIC, exportedAt: Date.now(), data: collectBackup() }, null, 2);
    const name = `forge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      const { saved, path } = await saveTextFile(name, payload, { name: "Forge backup", extensions: ["json"] });
      if (saved) setNotice(path ? `Backup saved to ${path}` : "Backup saved.");
    } catch (e) {
      setNotice(`Backup failed: ${errorMessage(e)}`);
    }
  };

  // Logs are already redacted when written, so the file is safe to attach to a bug report.
  const saveLogs = async () => {
    const name = `forge-logs-${new Date().toISOString().slice(0, 10)}.jsonl`;
    try {
      const { saved, path } = await saveTextFile(name, exportLogs(), { name: "Forge logs", extensions: ["jsonl"] });
      if (saved) setNotice(path ? `Logs saved to ${path}` : "Logs saved.");
    } catch (e) {
      setNotice(`Saving logs failed: ${errorMessage(e)}`);
    }
  };

  const importBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.magic !== BACKUP_MAGIC || !parsed.data) throw new Error("Not a Forge backup file.");
      const ok = await confirm({
        title: "Restore this backup?",
        body: "This replaces all current Forge data on this device. Your stored credentials are kept.",
        confirmLabel: "Restore",
      });
      if (!ok) return;
      applyBackup(parsed.data);
      location.reload();
    } catch (err) {
      setNotice(`Import failed: ${errorMessage(err)}`);
    }
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader
        title="Data & backup"
        hint="Back up everything to a file, or restore from one. Credentials are excluded."
      />
      <DataStats />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button icon="download" onClick={exportBackup}>
          Export backup
        </Button>
        <label className="btn-outline cursor-pointer">
          <Icon name="upload" size={15} /> Import
          <input type="file" accept=".json,.forge" hidden onChange={importBackup} />
        </label>
        <Button variant="ghost" icon="download" onClick={saveLogs} title="Diagnostic log, secrets removed">
          Export logs
        </Button>
      </div>
      {notice && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-2" role="status">
          {notice}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-[13px] text-ink-2">
          Delete everything Forge has stored on this device. This cannot be undone.
        </span>
        <Button variant="danger" icon="trash" onClick={resetAll}>
          Clear All My Data
        </Button>
      </div>
    </Card>
  );
}

function DataStats() {
  const gaps = useGaps((s) => s.gaps.length);
  const agents = useGaps((s) => s.gaps.reduce((a, g) => a + g.agents.length, 0));
  const convs = useConversations((s) => s.conversations.length);
  const runs = useRuns((s) => s.runs.length);
  return (
    <div className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border">
      {[
        ["Packs", gaps],
        ["Agents", agents],
        ["Chats", convs],
        ["Runs", runs],
      ].map(([label, n]) => (
        <div key={label as string} className="px-4 py-3">
          <div className="text-xs text-ink-3">{label as string}</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{n as number}</div>
        </div>
      ))}
    </div>
  );
}
