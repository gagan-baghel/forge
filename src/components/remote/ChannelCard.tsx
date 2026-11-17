import { useState } from "react";
import type { Agent, Channel } from "@/types/domain";
import { Badge, Button, StatusDot, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { startChannel, stopChannel, syncKeepAwake } from "@/lib/channelRuntime";
import { isDesktop } from "@/lib/platform";
import { PROVIDER, type ChannelKind } from "./provider";
import { CredentialsForm } from "./CredentialsForm";
import { Owners } from "./Owners";
import { DiscordWebhook } from "./DiscordWebhook";
import { SetupGuide } from "./SetupGuide";

export type { ChannelKind } from "./provider";

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
          <Button
            variant={running ? "outline" : "primary"}
            icon={running ? "pause" : "play"}
            disabled={!desktop || busy}
            onClick={toggleRun}
          >
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
        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
        )}

        {editing || !connected ? (
          <CredentialsForm
            kind={kind}
            channel={channel}
            onCancel={connected ? () => setEditing(false) : undefined}
            onSave={save}
          />
        ) : (
          <>
            <Toggle
              checked={!!channel?.remoteControl}
              onChange={setRemote}
              label="Remote control"
              description="Paired phones can have this agent act on this Mac — each action needs your approval on the phone."
            />
            <Owners agent={agent} channel={channel!} running={running} bot={bot} />
            {kind === "discord" && (
              <DiscordWebhook
                agent={agent}
                channel={channel!}
                onSave={(webhook) => save({ config: { webhook } }, false)}
              />
            )}
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
