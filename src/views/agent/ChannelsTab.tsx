import { useState, type ReactNode } from "react";
import type { Agent, Channel } from "@/types/domain";
import { Card, Badge, Button, Field, Modal } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { startTelegram, startDiscord, stopChannel, discordSend } from "@/lib/channelRuntime";
import { isDesktop } from "@/lib/platform";

export function ChannelsTab({ agent }: { agent: Agent }) {
  const upsertChannel = useGaps((s) => s.upsertChannel);
  const removeChannel = useGaps((s) => s.removeChannel);
  const running = useChannelRuntime((s) => s.running);
  const errors = useChannelRuntime((s) => s.lastError);
  const desktop = isDesktop();

  const telegram = agent.channels.find((c) => c.kind === "telegram");
  const discord = agent.channels.find((c) => c.kind === "discord");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!desktop && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Live channels run a bot poller on your machine — available in the desktop app only.
        </div>
      )}

      {/* Telegram */}
      <TelegramCard
        agent={agent}
        channel={telegram}
        desktop={desktop}
        running={!!telegram && running[channelKey(agent.id, telegram.id)]}
        error={telegram ? errors[channelKey(agent.id, telegram.id)] : ""}
        onSave={(token) => upsertChannel(agent.id, { id: "telegram", kind: "telegram", label: "Telegram", status: "inactive", token })}
        onRemove={() => telegram && removeChannel(agent.id, telegram.id)}
      />

      {/* Discord (two-way bot + outbound webhook) */}
      <DiscordCard
        agent={agent}
        channel={discord}
        desktop={desktop}
        running={!!discord && running[channelKey(agent.id, discord.id)]}
        error={discord ? errors[channelKey(agent.id, discord.id)] : ""}
        onSave={(patch) =>
          upsertChannel(agent.id, {
            id: "discord",
            kind: "discord",
            label: "Discord",
            status: discord?.status ?? "inactive",
            token: patch.token ?? discord?.token,
            config: { ...discord?.config, ...patch.config },
          })
        }
        onRemove={() => discord && removeChannel(agent.id, discord.id)}
      />
    </div>
  );
}

/** The "i" button: opens a step-by-step setup guide for a channel provider. */
function SetupInfo({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn-ghost ml-auto p-1.5 text-ink-3 hover:text-brand-2"
        onClick={() => setOpen(true)}
        aria-label={`How to set up ${title}`}
        title={`How to set up ${title}`}
      >
        <Icon name="info" size={16} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 text-sm text-ink-2">{children}</div>
      </Modal>
    </>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/15 text-[0.68rem] font-semibold text-brand-2">
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TelegramCard({
  agent,
  channel,
  desktop,
  running,
  error,
  onSave,
  onRemove,
}: {
  agent: Agent;
  channel?: Channel;
  desktop: boolean;
  running: boolean;
  error?: string;
  onSave: (token: string) => void;
  onRemove: () => void;
}) {
  const [token, setToken] = useState(channel?.token ?? "");

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon name="message" size={18} className="text-brand-2" />
        <h3 className="font-semibold">Telegram</h3>
        {running ? <Badge tone="success">live</Badge> : channel ? <Badge tone="neutral">stopped</Badge> : null}
        <SetupInfo title="Set up Telegram">
          <Step n={1}>
            In Telegram, open <strong>@BotFather</strong> and send <code className="font-mono">/newbot</code>.
          </Step>
          <Step n={2}>Give the bot a display name, then a username ending in “bot” (e.g. <code className="font-mono">forge_scout_bot</code>).</Step>
          <Step n={3}>
            BotFather replies with an HTTP API token like{" "}
            <code className="font-mono">123456:ABC-DEF…</code> — copy it and paste it into the token field here.
          </Step>
          <Step n={4}>
            Tap <strong>Save token</strong>, then <strong>Start bot</strong> (desktop app only — the poller runs on your
            machine).
          </Step>
          <Step n={5}>
            Open your bot in Telegram and send it a message — this agent answers. It also works when the bot is added to
            a group.
          </Step>
          <p className="text-xs text-ink-3">
            The token is stored locally on this device only. Stop the bot anytime with <strong>Stop bot</strong>.
          </p>
        </SetupInfo>
      </div>
      <p className="text-sm text-ink-3">
        Create a bot with @BotFather, paste its token, then start the bot. Messages to your bot are answered by this agent.
      </p>
      <Field label="Bot token">
        <input
          className="input font-mono"
          type="password"
          placeholder="123456:ABC-DEF…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
      {error && <div className="text-xs text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        {channel && (
          <Button variant="danger" icon="trash" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button onClick={() => onSave(token)} disabled={!token.trim()}>
          Save token
        </Button>
        {running ? (
          <Button icon="stop" onClick={() => channel && stopChannel(agent, channel)}>
            Stop bot
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="bolt"
            disabled={!desktop || !channel?.token}
            onClick={() => channel && startTelegram(agent, channel)}
          >
            Start bot
          </Button>
        )}
      </div>
    </Card>
  );
}

function DiscordCard({
  agent,
  channel,
  desktop,
  running,
  error,
  onSave,
  onRemove,
}: {
  agent: Agent;
  channel?: Channel;
  desktop: boolean;
  running: boolean;
  error?: string;
  onSave: (patch: { token?: string; config?: Record<string, string> }) => void;
  onRemove: () => void;
}) {
  const [token, setToken] = useState(channel?.token ?? "");
  const [channelId, setChannelId] = useState(channel?.config?.channelId ?? "");
  const [trigger, setTrigger] = useState(channel?.config?.trigger ?? "all");
  const [webhook, setWebhook] = useState(channel?.config?.webhook ?? "");
  const [sent, setSent] = useState("");

  const canStart = !!channel?.token && !!channel?.config?.channelId;

  const test = async () => {
    try {
      await discordSend(webhook, `✅ ${agent.name} connected to this channel via Forge.`);
      setSent("Sent a test message.");
    } catch (e: any) {
      setSent(`Failed: ${e?.message ?? e}`);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon name="message" size={18} className="text-brand-2" />
        <h3 className="font-semibold">Discord</h3>
        {running ? <Badge tone="success">live</Badge> : channel?.token ? <Badge tone="neutral">stopped</Badge> : null}
        <SetupInfo title="Set up Discord">
          <p className="font-medium text-ink">Two-way bot (reads & replies)</p>
          <Step n={1}>
            Go to <strong>discord.com/developers/applications</strong> → <strong>New Application</strong>, name it
            after your agent.
          </Step>
          <Step n={2}>
            In the <strong>Bot</strong> tab: click <strong>Reset Token</strong>, copy the token, and enable{" "}
            <strong>Message Content Intent</strong> under Privileged Gateway Intents.
          </Step>
          <Step n={3}>
            In <strong>OAuth2 → URL Generator</strong>: check <em>bot</em>, then <em>View Channels</em>,{" "}
            <em>Send Messages</em>, <em>Read Message History</em>. Open the generated URL to invite the bot to your
            server.
          </Step>
          <Step n={4}>
            In Discord, enable <strong>Developer Mode</strong> (Settings → Advanced), then right-click your channel →{" "}
            <strong>Copy Channel ID</strong>.
          </Step>
          <Step n={5}>
            Paste the bot token and channel ID here, <strong>Save</strong>, then <strong>Start bot</strong> (desktop
            app only). Messages in that channel are answered by this agent.
          </Step>
          <p className="border-t border-border pt-3 font-medium text-ink">Outbound webhook (post only)</p>
          <Step n={1}>
            Server Settings → <strong>Integrations → Webhooks → New Webhook</strong>, pick a channel, and{" "}
            <strong>Copy Webhook URL</strong>.
          </Step>
          <Step n={2}>
            Paste it below and <strong>Send test</strong> — scheduled routines deliver their results there
            automatically.
          </Step>
          <p className="text-xs text-ink-3">Tokens are stored locally on this device only.</p>
        </SetupInfo>
      </div>

      {/* Two-way bot */}
      <p className="text-sm text-ink-3">
        Two-way bot: paste a bot token and a channel ID, start the bot, and messages in that channel are answered by
        this agent.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bot token">
          <input
            className="input font-mono"
            type="password"
            placeholder="MTA2…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        <Field label="Channel ID">
          <input
            className="input font-mono"
            placeholder="123456789012345678"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Respond to">
        <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
          <option value="all">Every message in the channel</option>
          <option value="mention">Only when @mentioned</option>
        </select>
      </Field>
      {error && <div className="text-xs text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        {channel && (
          <Button variant="danger" icon="trash" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button
          onClick={() => onSave({ token, config: { channelId, trigger } })}
          disabled={!token.trim() || !channelId.trim()}
        >
          Save bot
        </Button>
        {running ? (
          <Button icon="stop" onClick={() => channel && stopChannel(agent, channel)}>
            Stop bot
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="bolt"
            disabled={!desktop || !canStart}
            onClick={() => channel && startDiscord(agent, channel)}
          >
            Start bot
          </Button>
        )}
      </div>

      {/* Outbound webhook */}
      <div className="space-y-3 border-t border-border pt-4">
        <Field label="Webhook URL" hint="Optional, post-only: schedules deliver results here.">
          <input
            className="input font-mono"
            placeholder="https://discord.com/api/webhooks/…"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
          />
        </Field>
        {sent && <div className="text-xs text-ink-3">{sent}</div>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onSave({ config: { webhook } })} disabled={!webhook.trim()}>
            Save webhook
          </Button>
          <Button variant="primary" icon="send" disabled={!desktop || !webhook.trim()} onClick={test}>
            Send test
          </Button>
        </div>
      </div>
    </Card>
  );
}
