import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Button, Card, Field, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useClaudeCode } from "@/hooks/useClaudeCode";
import { useSettings } from "@/stores/settings";
import { collectBackup, applyBackup, BACKUP_MAGIC } from "@/lib/backup";
import { saveTextFile } from "@/lib/saveFile";
import { useDialog } from "@/components/Confirm";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useRuns } from "@/stores/runs";
import { MODELS } from "@/types/domain";

const APP_VERSION = __APP_VERSION__;

export function SettingsView() {
  const { confirm } = useDialog();
  const s = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(s.apiKey);
  const [notice, setNotice] = useState("");

  const resetAll = async () => {
    const ok = await confirm({
      title: "Wipe all data?",
      body: "Every GAP, agent, chat and run on this device is deleted, and your stored credentials are cleared. This cannot be undone.",
      confirmLabel: "Wipe everything",
    });
    if (!ok) return;
    // explicitly or a "wipe everything" would quietly leave the API key behind.
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
      setNotice(`Backup failed: ${(e as Error).message}`);
    }
  };

  const importBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    } catch (err: any) {
      setNotice(`Import failed: ${err.message ?? err}`);
    }
    e.target.value = "";
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={`Forge ${APP_VERSION} — local-first, everything here lives on this device`}
      />
      <div className="mx-auto max-w-3xl space-y-6 p-7">
        {/* API */}
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="bolt" size={18} className="text-brand-2" />
            <h3 className="font-semibold">Claude API</h3>
            <Badge tone={s.apiKey ? "success" : "warn"}>{s.apiKey ? "configured" : "not set"}</Badge>
          </div>
          <Field label="API key" hint="Stored on this device only, and stripped out of exported backups. Sent only to Anthropic.">
            <div className="flex gap-2">
              <input
                className="input font-mono"
                type={showKey ? "text" : "password"}
                value={keyDraft}
                placeholder="sk-ant-…"
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <Button onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide" : "Show"}</Button>
              <Button variant="primary" onClick={() => s.setApiKey(keyDraft.trim())} disabled={keyDraft === s.apiKey}>
                Save
              </Button>
            </div>
          </Field>
          <Field label="Default model">
            <select className="input" value={s.defaultModel} onChange={(e) => s.setDefaultModel(e.target.value as any)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.blurb}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        {/* Runtime */}
        <RuntimeSection />

        {/* Appearance */}
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="settings" size={18} className="text-brand-2" />
            <h3 className="font-semibold">Appearance</h3>
          </div>
          <Field label="Theme">
            <div className="flex gap-2">
              {(["dusk", "paper"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => s.setTheme(t)}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm capitalize transition-colors ${
                    s.theme === t ? "border-brand bg-brand/10" : "border-border hover:bg-surface-2"
                  }`}
                >
                  {t === "dusk" ? "🌙 Dusk (dark)" : "📄 Paper (light)"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Display name">
            <input className="input" value={s.userName} placeholder="Your name" onChange={(e) => s.setUserName(e.target.value)} />
          </Field>
        </Card>

        {/* Pricing */}
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="chart" size={18} className="text-brand-2" />
            <h3 className="font-semibold">Price overrides</h3>
          </div>
          <p className="text-sm text-ink-3">USD per million tokens. Used for cost estimates in runs and chats.</p>
          <div className="space-y-2">
            {MODELS.map((m) => {
              const price = s.priceOverrides[m.id] ?? m.price;
              return (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="w-28 text-sm">{m.label}</span>
                  <label className="flex items-center gap-1 text-xs text-ink-3">
                    in
                    <input
                      type="number"
                      step={0.1}
                      className="input w-20"
                      value={price.in}
                      onChange={(e) => s.setPriceOverride(m.id, { ...price, in: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-ink-3">
                    out
                    <input
                      type="number"
                      step={0.1}
                      className="input w-20"
                      value={price.out}
                      onChange={(e) => s.setPriceOverride(m.id, { ...price, out: Number(e.target.value) })}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Data */}
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="grid" size={18} className="text-brand-2" />
            <h3 className="font-semibold">Data &amp; backup</h3>
          </div>
          <DataStats />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <span className="text-sm text-ink-2">
              Back up everything to a file, or restore from one. Credentials are excluded.
            </span>
            <div className="flex gap-2">
              <Button icon="download" onClick={exportBackup}>
                Export backup
              </Button>
              <label className="btn-outline cursor-pointer">
                <Icon name="upload" size={15} /> Import
                <input type="file" accept=".json,.forge" hidden onChange={importBackup} />
              </label>
            </div>
          </div>
          {notice && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2" role="status">
              {notice}
            </p>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-ink-2">Reset Forge to a clean state.</span>
            <Button variant="danger" icon="trash" onClick={resetAll}>
              Wipe all data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function RuntimeSection() {
  const runtime = useSettings((s) => s.runtime);
  const setRuntime = useSettings((s) => s.setRuntime);
  const apiKey = useSettings((s) => s.apiKey);
  const ccToken = useSettings((s) => s.ccToken);
  const setCcToken = useSettings((s) => s.setCcToken);
  const [ccDraft, setCcDraft] = useState(ccToken);
  const { info, available, desktop, install, installing, installLog, installError } = useClaudeCode();
  const onCC = runtime === "claude-code";

  // Keep the draft in step if the stored token changes underneath us.
  useEffect(() => setCcDraft(ccToken), [ccToken]);

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon name="plug" size={18} className="text-brand-2" />
        <h3 className="font-semibold">Runtime</h3>
      </div>
      <p className="text-sm text-ink-3">How agents run. Each agent can override this in its Config tab.</p>

      {/* Local Claude Code daemon — automatic, no connect step. */}
      <button
        onClick={() => setRuntime("claude-code")}
        className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors ${
          onCC ? "border-brand bg-brand/10" : "border-border hover:bg-surface-2"
        }`}
      >
        <div>
          <div className="font-medium">Local Claude Code</div>
          <p className="text-xs text-ink-3">
            Runs on your local Claude Code — no API key, nothing metered.
            {available && info?.version ? ` Using ${info.version.split(" ")[0]}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={desktop && available ? "success" : "warn"}>
            {!desktop ? "desktop only" : available ? "ready" : "not found"}
          </Badge>
          {onCC && <Icon name="check" size={16} className="text-brand-2" />}
        </div>
      </button>

      {/* Without the CLI the Claude Code runtime cannot run at all, so offer
          the in-app install rather than leaving the user at a dead end. */}
      {desktop && !available && (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-2">
              The Claude Code CLI isn&apos;t on this machine. Forge can install it for you.
            </span>
            <Button variant="primary" onClick={() => void install()} disabled={installing}>
              {installing ? "Installing…" : "Install Claude Code"}
            </Button>
          </div>
          {installing && <p className="text-xs text-ink-3">This needs an internet connection and may take a minute.</p>}
          {installLog.length > 0 && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink-3">
              {installLog.join("\n")}
            </pre>
          )}
          {installError && <p className="text-sm text-danger">{installError}</p>}
        </div>
      )}

      {/* Headless runs can't refresh the CLI's own short-lived session token,
          so they 401 even while `claude` works fine in a terminal. A long-lived
          token from `claude setup-token` is the supported fix; it is passed to
          every run as CLAUDE_CODE_OAUTH_TOKEN. */}
      {desktop && available && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Background-run token</span>
            <Badge tone={ccToken ? "success" : "warn"}>{ccToken ? "connected" : "not set"}</Badge>
          </div>
          <p className="text-xs text-ink-3">
            Not an API key — this is your existing Claude Code subscription, still $0 and nothing metered.
            Being signed in to <code>claude</code> in a terminal is normally enough, but that session&apos;s
            token is short-lived and background runs can&apos;t refresh it, so they start failing while your
            terminal keeps working. A long-lived token off the same subscription fixes it for good:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink-2">claude setup-token</pre>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono"
              type="password"
              placeholder="sk-ant-oat…"
              value={ccDraft}
              onChange={(e) => setCcDraft(e.target.value)}
            />
            <Button
              variant="primary"
              onClick={() => setCcToken(ccDraft.trim())}
              disabled={ccDraft.trim() === ccToken}
            >
              Save
            </Button>
            {ccToken && (
              <Button
                onClick={() => {
                  setCcToken("");
                  setCcDraft("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-3">Stored on this device only, and stripped out of exported backups.</p>
        </div>
      )}

      {/* Optional fallback: the metered API. */}
      <button
        onClick={() => setRuntime("api")}
        className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors ${
          runtime === "api" ? "border-brand bg-brand/10" : "border-border hover:bg-surface-2"
        }`}
      >
        <div>
          <div className="font-medium">Use Claude API instead</div>
          <p className="text-xs text-ink-3">Direct BYOK calls, metered per token.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={apiKey ? "success" : "warn"}>{apiKey ? "key set" : "no key"}</Badge>
          {runtime === "api" && <Icon name="check" size={16} className="text-brand-2" />}
        </div>
      </button>
    </Card>
  );
}

function DataStats() {
  const gaps = useGaps((s) => s.gaps.length);
  const agents = useGaps((s) => s.gaps.reduce((a, g) => a + g.agents.length, 0));
  const convs = useConversations((s) => s.conversations.length);
  const runs = useRuns((s) => s.runs.length);
  return (
    <div className="grid grid-cols-4 gap-3 text-center">
      {[
        ["GAPs", gaps],
        ["Agents", agents],
        ["Chats", convs],
        ["Runs", runs],
      ].map(([label, n]) => (
        <div key={label as string} className="rounded-lg bg-surface-2 py-3">
          <div className="text-xl font-semibold">{n as number}</div>
          <div className="text-xs text-ink-3">{label as string}</div>
        </div>
      ))}
    </div>
  );
}
