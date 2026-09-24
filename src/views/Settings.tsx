import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Button, Card, CardHeader, Field, Badge, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useClaudeCode } from "@/hooks/useClaudeCode";
import { useSettings } from "@/stores/settings";
import { collectBackup, applyBackup, BACKUP_MAGIC } from "@/lib/backup";
import { saveTextFile } from "@/lib/saveFile";
import { useDialog } from "@/components/Confirm";
import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useRuns } from "@/stores/runs";
import { syncKeepAwake } from "@/lib/channelRuntime";
import { MODELS, type ThemeName } from "@/types/domain";

const APP_VERSION = __APP_VERSION__;

export function SettingsView() {
  const { confirm } = useDialog();
  const s = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(s.apiKey);
  const [notice, setNotice] = useState("");

  const resetAll = async () => {
    const ok = await confirm({
      title: "Clear all my data?",
      body: "Every GAP, agent, chat and run on this device is deleted, and your stored credentials are cleared. This cannot be undone.",
      confirmLabel: "Clear everything",
    });
    if (!ok) return;
    // clear() rather than removing the forge.* keys one by one: this is the
    // button people press to leave nothing behind, and a per-key sweep would
    // quietly spare the API key if a future key ever escapes the prefix.
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
      <PageBody className="max-w-3xl space-y-6">
        {/* API */}
        <Card>
          <CardHeader
            title="Claude API"
            hint="Optional — only needed for the metered API runtime."
            action={<Badge tone={s.apiKey ? "success" : "neutral"}>{s.apiKey ? "configured" : "not set"}</Badge>}
          />
          <div className="space-y-4">
            <Field label="API key" hint="Stored on this device only, and stripped out of exported backups. Sent only to Anthropic.">
              <div className="flex gap-2">
                <input
                  className="input font-mono"
                  type={showKey ? "text" : "password"}
                  value={keyDraft}
                  placeholder="sk-ant-…"
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <Button variant="ghost" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? "Hide" : "Show"}
                </Button>
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
          </div>
        </Card>

        {/* Runtime */}
        <RuntimeSection />

        {/* Remote */}
        <Card>
          <CardHeader
            title="Remote control"
            hint="Reach your agents from your phone over Telegram or Discord."
            action={
              <Link to="/remote" className="btn-outline">
                <Icon name="phone" size={14} /> Open Remote
              </Link>
            }
          />
          <Toggle
            checked={s.keepAwake}
            onChange={(on) => {
              s.setKeepAwake(on);
              setTimeout(syncKeepAwake);
            }}
            label="Keep this Mac awake while remote control is live"
            description="A sleeping Mac can't answer your phone. Closing the window keeps Forge running; ⌘Q quits."
          />
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader title="Appearance" />
          <div className="space-y-4">
            <Field label="Theme">
              <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={s.theme === t.id}
                    onClick={() => s.setTheme(t.id)}
                    className={clsx(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                      s.theme === t.id ? "border-border-strong bg-surface-2 text-ink" : "border-border text-ink-2 hover:bg-surface-2/50",
                    )}
                  >
                    <ThemeSwatch theme={t.id} />
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Display name">
              <input className="input" value={s.userName} placeholder="Your name" onChange={(e) => s.setUserName(e.target.value)} />
            </Field>
          </div>
        </Card>

        {/* Pricing */}
        <Card className="p-0">
          <div className="px-5 pt-4">
            <CardHeader title="Price overrides" hint="USD per million tokens. Used for cost estimates in runs and chats." />
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {MODELS.map((m) => {
              const price = s.priceOverrides[m.id] ?? m.price;
              return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2">
                  <span className="flex-1 text-[13px]">{m.label}</span>
                  <label className="flex items-center gap-1.5 text-xs text-ink-3">
                    in
                    <input
                      type="number"
                      step={0.1}
                      className="input w-20 font-mono"
                      value={price.in}
                      onChange={(e) => s.setPriceOverride(m.id, { ...price, in: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-ink-3">
                    out
                    <input
                      type="number"
                      step={0.1}
                      className="input w-20 font-mono"
                      value={price.out}
                      onChange={(e) => s.setPriceOverride(m.id, { ...price, out: Number(e.target.value) })}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Data */}
        <Card>
          <CardHeader title="Data & backup" hint="Back up everything to a file, or restore from one. Credentials are excluded." />
          <DataStats />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon="download" onClick={exportBackup}>
              Export backup
            </Button>
            <label className="btn-outline cursor-pointer">
              <Icon name="upload" size={15} /> Import
              <input type="file" accept=".json,.forge" hidden onChange={importBackup} />
            </label>
          </div>
          {notice && (
            <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-2" role="status">
              {notice}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-[13px] text-ink-2">Delete everything Forge has stored on this device. This cannot be undone.</span>
            <Button variant="danger" icon="trash" onClick={resetAll}>
              Clear All My Data
            </Button>
          </div>
        </Card>
      </PageBody>
    </div>
  );
}

const THEMES: { id: ThemeName; label: string }[] = [
  { id: "dusk", label: "Dark" },
  { id: "paper", label: "Light" },
  { id: "system", label: "System" },
];

/** A tiny preview chip of each theme's surface. */
function ThemeSwatch({ theme }: { theme: ThemeName }) {
  const dark = "linear-gradient(135deg, #1b1b1f 0 100%)";
  const light = "linear-gradient(135deg, #f4f4f5 0 100%)";
  const bg = theme === "dusk" ? dark : theme === "paper" ? light : "linear-gradient(135deg, #f4f4f5 0 50%, #1b1b1f 50% 100%)";
  return <span aria-hidden className="h-4 w-4 shrink-0 rounded border border-border-strong" style={{ background: bg }} />;
}

/** One selectable runtime: title, blurb, status badge and a radio mark. */
function Choice({
  selected,
  onSelect,
  title,
  body,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: ReactNode;
  badge: ReactNode;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
        selected ? "border-border-strong bg-surface-2" : "border-border hover:bg-surface-2/50",
      )}
    >
      <span
        className={clsx(
          "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-ink" : "border-border-strong",
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-ink" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <p className="text-xs text-ink-3">{body}</p>
      </div>
      {badge}
    </button>
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
    <Card>
      <CardHeader title="Runtime" hint="How agents run. Each agent can override this in its Config tab." />
      <div className="space-y-2">
        {/* Local Claude Code daemon — automatic, no connect step. */}
        <Choice
          selected={onCC}
          onSelect={() => setRuntime("claude-code")}
          title="Local Claude Code"
          body={
            <>
              Runs on your local Claude Code — no API key, nothing metered.
              {available && info?.version ? ` Using ${info.version.split(" ")[0]}.` : ""}
            </>
          }
          badge={
            <Badge tone={desktop && available ? "success" : "warn"}>
              {!desktop ? "desktop only" : available ? "ready" : "not found"}
            </Badge>
          }
        />

        {/* Without the CLI the Claude Code runtime cannot run at all, so offer
            the in-app install rather than leaving the user at a dead end. */}
        {desktop && !available && (
          <div className="space-y-2 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-ink-2">
                The Claude Code CLI isn&apos;t on this machine. Forge can install it for you.
              </span>
              <Button variant="primary" onClick={() => void install()} disabled={installing}>
                {installing ? "Installing…" : "Install Claude Code"}
              </Button>
            </div>
            {installing && <p className="text-xs text-ink-3">This needs an internet connection and may take a minute.</p>}
            {installLog.length > 0 && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-xs text-ink-3">
                {installLog.join("\n")}
              </pre>
            )}
            {installError && <p className="text-[13px] text-danger">{installError}</p>}
          </div>
        )}

        {/* Headless runs can't refresh the CLI's own short-lived session token,
            so they 401 even while `claude` works fine in a terminal. A long-lived
            token from `claude setup-token` is the supported fix; it is passed to
            every run as CLAUDE_CODE_OAUTH_TOKEN. */}
        {desktop && available && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">Background-run token</span>
              <Badge tone={ccToken ? "success" : "warn"}>{ccToken ? "connected" : "not set"}</Badge>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              Not an API key — this is your existing Claude Code subscription, still $0 and nothing metered.
              Being signed in to <code className="font-mono">claude</code> in a terminal is normally enough, but that session&apos;s
              token is short-lived and background runs can&apos;t refresh it, so they start failing while your
              terminal keeps working. A long-lived token off the same subscription fixes it for good:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-ink-2">claude setup-token</pre>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono"
                type="password"
                placeholder="sk-ant-oat…"
                value={ccDraft}
                onChange={(e) => setCcDraft(e.target.value)}
              />
              <Button variant="primary" onClick={() => setCcToken(ccDraft.trim())} disabled={ccDraft.trim() === ccToken}>
                Save
              </Button>
              {ccToken && (
                <Button
                  variant="ghost"
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
        <Choice
          selected={runtime === "api"}
          onSelect={() => setRuntime("api")}
          title="Use Claude API instead"
          body="Direct BYOK calls, metered per token."
          badge={<Badge tone={apiKey ? "success" : "warn"}>{apiKey ? "key set" : "no key"}</Badge>}
        />
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
        ["GAPs", gaps],
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
