import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { Agent, Channel } from "@/types/domain";
import { Badge, Button, Field, Modal, StatusDot, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/components/Confirm";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import {
  cancelPairing,
  discordSend,
  removeOwner,
  startChannel,
  startPairing,
  stopChannel,
  syncKeepAwake,
} from "@/lib/channelRuntime";
import { isDesktop } from "@/lib/platform";
import { relativeTime } from "@/lib/format";

export type ChannelKind = "telegram" | "discord";

const PROVIDER: Record<ChannelKind, { name: string; icon: string }> = {
  telegram: { name: "Telegram", icon: "send" },
  discord: { name: "Discord", icon: "message" },
};

/**
 * One agent's bot on one provider: connect it, run it, pair phones with it,
 * and decide whether it may act on this Mac. Shared by the Remote hub and the
 * agent's Channels tab so both always show the same thing.
 */
export function ChannelCard({ agent, kind, showAgent }: { agent: Agent; kind: ChannelKind; showAgent?: boolean }) {
  const channel = agent.channels.find((c) => c.kind === kind);
  const key = channel ? channelKey(agent.id, channel.id) : "";
  const running = useChannelRuntime((s) => (key ? !!s.running[key] : false));
  const error = useChannelRuntime((s) => (key ? s.lastError[key] : ""));
  const bot = useChannelRuntime((s) => (key ? s.botName[key] : ""));
  const { confirm } = useDialog();
  const upsertChannel = useGaps((s) => s.upsertChannel);
  const removeChannel = useGaps((s) => s.removeChannel);
  const addSkill = useGaps((s) => s.addSkill);
  const toggleSkill = useGaps((s) => s.toggleSkill);
  const [editing, setEditing] = useState(!channel?.token);
  const [busy, setBusy] = useState(false);
  const desktop = isDesktop();

  const connected = !!channel?.token;
  const owners = channel?.owners ?? [];

  const save = async (patch: Partial<Channel>, start: boolean) => {
    const next: Channel = {
      id: kind,
      kind,
      label: PROVIDER[kind].name,
      status: channel?.status ?? "inactive",
      ...channel,
      ...patch,
      config: { ...channel?.config, ...patch.config },
    };
    upsertChannel(agent.id, next);
    setEditing(false);
    if (start && desktop) {
      setBusy(true);
      if (running) await stopChannel(agent, next);
      await startChannel(agent, next);
      setBusy(false);
    }
  };

  const toggleRun = async () => {
    if (!channel) return;
    setBusy(true);
    if (running) await stopChannel(agent, channel);
    else await startChannel(agent, channel);
    setBusy(false);
  };

  const setRemote = async (on: boolean) => {
    if (!channel) return;
    if (on) {
      const ok = await confirm({
        title: `Let ${agent.name} control this Mac from your phone?`,
        body:
          "Paired phones can ask this agent to run commands, edit files, see the screen, click and type. " +
          "Every action is sent to your phone for approval first — nothing runs until you tap Approve " +
          "(or Allow 15 min). Only phones you pair can talk to it.",
        confirmLabel: "Turn on",
        danger: false,
      });
      if (!ok) return;
    }
    upsertChannel(agent.id, { ...channel, remoteControl: on });
    // Remote control is only as good as the agent's machine tools: make sure
    // the Computer skill (shell, files, screen, keyboard) is on.
    if (on) {
      const computer = agent.skills.find((s) => s.kind === "computer");
      if (!computer) {
        addSkill(agent.id, {
          name: "Computer",
          description: "Run commands, edit files, see the screen, click and type — asks first",
          kind: "computer",
          enabled: true,
        });
      } else if (!computer.enabled) {
        toggleSkill(agent.id, computer.id);
      }
    }
    syncKeepAwake();
  };

  const disconnect = async () => {
    if (!channel) return;
    const ok = await confirm({
      title: `Disconnect ${PROVIDER[kind].name}?`,
      body: "The bot stops, its token is deleted from this device, and every paired phone is unpaired.",
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    if (running) await stopChannel(agent, channel);
    removeChannel(agent.id, channel.id);
    setEditing(true);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface-2 text-ink-2">
          <Icon name={PROVIDER[kind].icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {showAgent ? (
              <>
                <span className="truncate">{agent.name}</span>
                <span className="text-ink-3">·</span>
                <span className="text-ink-2">{PROVIDER[kind].name}</span>
              </>
            ) : (
              PROVIDER[kind].name
            )}
            {channel?.remoteControl && <Badge tone="brand">remote control</Badge>}
          </div>
          <div className="truncate text-xs text-ink-3">
            {running ? (bot ? `Live as @${bot}` : "Live") : connected ? "Stopped" : "Not connected"}
            {connected && ` · ${owners.length} paired ${owners.length === 1 ? "phone" : "phones"}`}
          </div>
        </div>
        {connected && <StatusDot status={running ? "live" : "draft"} pulse={running} />}
        <SetupGuide kind={kind} />
        {connected && !editing && (
          <Button variant={running ? "outline" : "primary"} icon={running ? "pause" : "play"} disabled={!desktop || busy} onClick={toggleRun}>
            {running ? "Stop" : "Start"}
          </Button>
        )}
      </div>

      <div className="space-y-4 px-4 py-4">
        {!desktop && (
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            Bots run on your computer, so they need the desktop app.
          </p>
        )}
        {error && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

        {editing || !connected ? (
          <CredentialsForm kind={kind} channel={channel} onCancel={connected ? () => setEditing(false) : undefined} onSave={save} />
        ) : (
          <>
            <Toggle
              checked={!!channel?.remoteControl}
              onChange={setRemote}
              label="Remote control"
              description="Paired phones can have this agent act on this Mac — each action needs your approval on the phone."
            />
            <Owners agent={agent} channel={channel!} running={running} bot={bot} />
            {kind === "discord" && <DiscordWebhook agent={agent} channel={channel!} onSave={(webhook) => save({ config: { webhook } }, false)} />}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <button className="text-xs text-ink-3 hover:text-ink-2" onClick={() => setEditing(true)}>
                Change token{kind === "discord" ? " or channel" : ""}
              </button>
              <button className="text-xs text-danger/80 hover:text-danger" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Credentials ------------------------------ */

function CredentialsForm({
  kind,
  channel,
  onSave,
  onCancel,
}: {
  kind: ChannelKind;
  channel?: Channel;
  onSave: (patch: Partial<Channel>, start: boolean) => void;
  onCancel?: () => void;
}) {
  const [token, setToken] = useState(channel?.token ?? "");
  const [channelId, setChannelId] = useState(channel?.config?.channelId ?? "");
  const [trigger, setTrigger] = useState(channel?.config?.trigger ?? "all");
  const ready = token.trim() && (kind === "telegram" || channelId.trim());

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        {kind === "telegram" ? (
          <>
            Create a bot with <strong className="font-medium text-ink">@BotFather</strong> in Telegram (send{" "}
            <code className="font-mono text-xs">/newbot</code>) and paste the token it gives you.
          </>
        ) : (
          <>Paste a Discord bot token and the ID of the channel it should listen in. The guide (ⓘ) walks through it.</>
        )}
      </p>
      <div className={clsx("grid gap-3", kind === "discord" && "sm:grid-cols-2")}>
        <Field label="Bot token">
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder={kind === "telegram" ? "123456789:AA…" : "MTA2…"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        {kind === "discord" && (
          <Field label="Channel ID">
            <input className="input font-mono" placeholder="123456789012345678" value={channelId} onChange={(e) => setChannelId(e.target.value)} />
          </Field>
        )}
      </div>
      {kind === "discord" && (
        <Field label="Respond to">
          <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            <option value="all">Every message from a paired person</option>
            <option value="mention">Only when @mentioned</option>
          </select>
        </Field>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          icon="bolt"
          disabled={!ready}
          onClick={() =>
            onSave(
              {
                token: token.trim(),
                ...(kind === "discord" ? { config: { channelId: channelId.trim(), trigger } } : {}),
              },
              true,
            )
          }
        >
          Connect &amp; start
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Owners -------------------------------- */

function Owners({ agent, channel, running, bot }: { agent: Agent; channel: Channel; running: boolean; bot: string }) {
  const key = channelKey(agent.id, channel.id);
  const pairing = useChannelRuntime((s) => s.pairing[key]);
  const { confirm } = useDialog();
  const owners = channel.owners ?? [];
  const [, tick] = useState(0);

  // Count the code down; drop it when it expires.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => {
      if (pairing.expiresAt < Date.now()) cancelPairing(agent, channel);
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [pairing, agent, channel]);

  const unpair = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Unpair ${name}?`,
      body: "Their messages stop reaching this agent. They can pair again with a new code.",
      confirmLabel: "Unpair",
    });
    if (ok) removeOwner(agent.id, channel, id);
  };

  const left = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000)) : 0;
  const pairTarget = channel.kind === "telegram" ? (bot ? `@${bot}` : "your bot") : "the Discord channel";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">Paired phones</span>
        {!pairing && (
          <Button variant="ghost" icon="plus" className="h-7 px-2" disabled={!running} onClick={() => startPairing(agent, channel)}>
            Pair a phone
          </Button>
        )}
      </div>

      {pairing && (
        <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[13px] text-ink-2">
              From your phone, send this to <strong className="font-medium text-ink">{pairTarget}</strong>:
            </div>
            <button className="text-xs text-ink-3 hover:text-ink" onClick={() => cancelPairing(agent, channel)}>
              Cancel
            </button>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <code className="select-all font-mono text-2xl font-semibold tracking-[0.12em] text-ink">/pair {pairing.code}</code>
            <span className="font-mono text-xs text-ink-3">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </span>
          </div>
        </div>
      )}

      {owners.length === 0 && !pairing ? (
        <p className="text-xs text-ink-3">
          {running ? "No phone paired yet — nobody can use this bot until you pair one." : "Start the bot, then pair your phone."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {owners.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-2">
              <Icon name="phone" size={14} className="text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{o.name}</div>
                <div className="font-mono text-[11px] text-ink-3">
                  id {o.id} · paired {relativeTime(o.pairedAt)}
                </div>
              </div>
              <button className="text-xs text-ink-3 hover:text-danger" onClick={() => void unpair(o.id, o.name)}>
                Unpair
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------- Discord webhook ---------------------------- */

function DiscordWebhook({ agent, channel, onSave }: { agent: Agent; channel: Channel; onSave: (url: string) => void }) {
  const [webhook, setWebhook] = useState(channel.config?.webhook ?? "");
  const [note, setNote] = useState("");
  const test = async () => {
    try {
      await discordSend(webhook, `✅ ${agent.name} is connected to this channel via Forge.`);
      setNote("Sent a test message.");
    } catch (e: any) {
      setNote(`Failed: ${e?.message ?? e}`);
    }
  };
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] text-ink-2">
        Outbound webhook <span className="text-xs text-ink-3">{channel.config?.webhook ? "set" : "optional"}</span>
      </summary>
      <div className="space-y-2 border-t border-border p-3">
        <Field label="Webhook URL" hint="Scheduled routines also post their results here.">
          <input className="input font-mono" placeholder="https://discord.com/api/webhooks/…" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        </Field>
        {note && <p className="text-xs text-ink-3">{note}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onSave(webhook.trim())} disabled={!webhook.trim()}>
            Save
          </Button>
          <Button icon="send" disabled={!isDesktop() || !webhook.trim()} onClick={test}>
            Send test
          </Button>
        </div>
      </div>
    </details>
  );
}

/* ------------------------------- Setup guide ----------------------------- */

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border bg-surface-2 font-mono text-[10px] text-ink-2">
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SetupGuide({ kind }: { kind: ChannelKind }) {
  const [open, setOpen] = useState(false);
  const title = `Set up ${PROVIDER[kind].name}`;
  return (
    <>
      <button className="btn-ghost h-7 px-1.5 text-ink-3" onClick={() => setOpen(true)} aria-label={`How to set up ${PROVIDER[kind].name}`} title={title}>
        <Icon name="info" size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 text-[13px] text-ink-2">
          {kind === "telegram" ? (
            <>
              <Step n={1}>
                In Telegram, open <strong className="text-ink">@BotFather</strong> and send <code className="font-mono">/newbot</code>.
              </Step>
              <Step n={2}>Pick a display name, then a username ending in “bot”.</Step>
              <Step n={3}>
                Copy the token BotFather sends (<code className="font-mono">123456:ABC…</code>), paste it here, and press{" "}
                <strong className="text-ink">Connect &amp; start</strong>.
              </Step>
              <Step n={4}>
                Press <strong className="text-ink">Pair a phone</strong>, then send the <code className="font-mono">/pair</code> code to your bot
                from Telegram. Only paired phones can use it.
              </Step>
              <Step n={5}>
                Turn on <strong className="text-ink">Remote control</strong> if this agent should be able to act on this Mac. Every action
                asks your phone first.
              </Step>
            </>
          ) : (
            <>
              <Step n={1}>
                At <strong className="text-ink">discord.com/developers/applications</strong> create an application.
              </Step>
              <Step n={2}>
                In <strong className="text-ink">Bot</strong>: Reset Token and copy it, and enable{" "}
                <strong className="text-ink">Message Content Intent</strong>.
              </Step>
              <Step n={3}>
                In <strong className="text-ink">OAuth2 → URL Generator</strong> tick <em>bot</em> with <em>View Channels</em>,{" "}
                <em>Send Messages</em>, <em>Attach Files</em>, <em>Read Message History</em>; open the URL to invite it.
              </Step>
              <Step n={4}>
                Enable Developer Mode (Settings → Advanced), right-click the channel → <strong className="text-ink">Copy Channel ID</strong>.
              </Step>
              <Step n={5}>
                Paste both here, <strong className="text-ink">Connect &amp; start</strong>, then pair: post the{" "}
                <code className="font-mono">/pair</code> code in that channel. Approvals are answered by replying yes, trust or no.
              </Step>
            </>
          )}
          <p className="text-xs text-ink-3">Tokens stay on this device. They are removed from exported packs and backups.</p>
        </div>
      </Modal>
    </>
  );
}
