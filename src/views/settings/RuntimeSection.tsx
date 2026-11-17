import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { useClaudeCode } from "@/hooks/useClaudeCode";
import { useSettings } from "@/stores/settings";

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

export function RuntimeSection() {
  const runtime = useSettings((s) => s.runtime);
  const setRuntime = useSettings((s) => s.setRuntime);
  const apiKey = useSettings((s) => s.apiKey);
  const ccToken = useSettings((s) => s.ccToken);
  const { info, available, desktop, install, installing, installLog, installError } = useClaudeCode();
  const onCC = runtime === "claude-code";

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
            {installing && (
              <p className="text-xs text-ink-3">This needs an internet connection and may take a minute.</p>
            )}
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
              Not an API key — this is your existing Claude Code subscription, still $0 and nothing metered. Being
              signed in to <code className="font-mono">claude</code> in a terminal is normally enough, but that
              session&apos;s token is short-lived and background runs can&apos;t refresh it, so they start failing while
              your terminal keeps working. A long-lived token off the same subscription fixes it for good:
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-ink-2">
              claude setup-token
            </pre>
            {/* Keyed on the stored token: the draft restarts if it changes underneath us. */}
            <CcTokenForm key={ccToken} />
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

function CcTokenForm() {
  const ccToken = useSettings((s) => s.ccToken);
  const setCcToken = useSettings((s) => s.setCcToken);
  const [ccDraft, setCcDraft] = useState(ccToken);
  return (
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
  );
}
