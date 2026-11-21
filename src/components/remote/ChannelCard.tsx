import { useState } from "react";
import clsx from "clsx";
import type { Channel } from "@/types/domain";
import { Badge, Button, StatusDot, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BotFace, BotStack } from "@/components/BotFace";
import { useDialog } from "@/hooks/useDialog";
import { useGaps } from "@/stores/gaps";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { hostChannels, isPack, startChannel, stopChannel, syncKeepAwake, type Host } from "@/lib/channelRuntime";
import { isDesktop } from "@/lib/platform";
import { PROVIDER, type ChannelKind } from "./provider";
import { CredentialsForm } from "./CredentialsForm";
import { Owners } from "./Owners";
import { DiscordWebhook } from "./DiscordWebhook";
import { SetupGuide } from "./SetupGuide";

export type { ChannelKind } from "./provider";

/**
 * One bot on one provider, for an agent or a whole pack: a single row that
 * says what matters (live or not, paired phones, remote control) and opens
 * on a tap to connect it, pair phones, and decide whether it may act on
 * this Mac. A bot that isn't connected yet opens straight away.
 */
export function ChannelCard({ host, kind, open: startOpen }: { host: Host; kind: ChannelKind; open?: boolean }) {
  const channel = hostChannels(host).find((c) => c.kind === kind);
  const key = channel ? channelKey(host.id, channel.id) : "";
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
  const pack = isPack(host);

  const connected = !!channel?.token;
  const owners = channel?.owners ?? [];
  const [open, setOpen] = useState(startOpen ?? !connected);

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
    upsertChannel(host.id, next);
    setEditing(false);
    if (start && desktop) {
      setBusy(true);
      if (running) await stopChannel(host, next);
      await startChannel(host, next);
      setBusy(false);
    }
  };

  const toggleRun = async () => {
    if (!channel) return;
    setBusy(true);
    if (running) await stopChannel(host, channel);
    else await startChannel(host, channel);
    setBusy(false);
  };

  const setRemote = async (on: boolean) => {
    if (!channel) return;
    if (on) {
      const ok = await confirm({
        title: `Let ${host.name} control this Mac from your phone?`,
        body:
          `Paired phones can ask ${pack ? "this pack's agents" : "this agent"} to run commands, edit files, see the ` +
          "screen, click and type. Every action is sent to your phone for approval first — nothing runs until you " +
          "tap Approve (or Allow 15 min). Only phones you pair can talk to it.",
        confirmLabel: "Turn on",
        danger: false,
      });
      if (!ok) return;
    }
    upsertChannel(host.id, { ...channel, remoteControl: on });
    // Remote control is only as good as the agent's machine tools: make sure
    // the Computer skill (shell, files, screen, keyboard) is on. A pack's
    // agents keep the skills you gave them: which of them may touch the
    // machine stays your call, on each agent.
    if (on && !pack) {
      const computer = host.skills.find((s) => s.kind === "computer");
      if (!computer) {
        addSkill(host.id, {
          name: "Computer",
          description: "Run commands, edit files, see the screen, click and type — asks first",
          kind: "computer",
          enabled: true,
        });
      } else if (!computer.enabled) {
        toggleSkill(host.id, computer.id);
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
    if (running) await stopChannel(host, channel);
    removeChannel(host.id, channel.id);
    setEditing(true);
  };

  const withComputer = pack ? host.agents.filter((a) => a.skills.some((s) => s.kind === "computer" && s.enabled)) : [];

  return (
    <div className="card overflow-hidden">
      {/* The row: everything at a glance; tap to open */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {pack ? <BotStack agents={host.agents} size={24} /> : <BotFace name={host.name} size={26} />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <span className="truncate">{host.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-ink-3">
                <Icon name={PROVIDER[kind].icon} size={12} />
                {PROVIDER[kind].name}
              </span>
              {channel?.remoteControl && <Badge tone="brand">remote control</Badge>}
            </span>
            <span className="block truncate text-xs text-ink-3">
              {running ? (bot ? `Live as @${bot}` : "Live") : connected ? "Stopped" : "Not connected"}
              {connected && ` · ${owners.length} paired ${owners.length === 1 ? "phone" : "phones"}`}
              {error && <span className="text-danger"> · needs attention</span>}
            </span>
          </span>
          {connected && <StatusDot status={running ? "live" : "draft"} pulse={running} />}
        </button>
        {connected && !editing && (
          <Button
            variant={running ? "outline" : "primary"}
            icon={running ? "pause" : "play"}
            className="h-7 px-2.5 text-xs"
            disabled={!desktop || busy}
            onClick={toggleRun}
          >
            {running ? "Stop" : "Start"}
          </Button>
        )}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Hide details" : "Show details"}
          className="btn-ghost h-7 w-7 shrink-0 px-0 text-ink-3"
        >
          <Icon name="chevron" size={14} className={clsx("transition-transform", open && "rotate-90")} />
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <div className="flex justify-end">
            <SetupGuide kind={kind} />
          </div>
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
                description={
                  pack
                    ? `Paired phones can have this pack's agents act on this Mac — each action needs your approval on the phone. ${
                        withComputer.length
                          ? `Able to: ${withComputer.map((a) => a.name).join(", ")} (they have the Computer skill).`
                          : "None of its agents has the Computer skill yet — turn it on for the ones that should."
                      }`
                    : "Paired phones can have this agent act on this Mac — each action needs your approval on the phone."
                }
              />
              <Owners host={host} channel={channel!} running={running} bot={bot} />
              {kind === "discord" && (
                <DiscordWebhook
                  host={host}
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
      )}
    </div>
  );
}
