import { useEffect, useState } from "react";
import type { Agent, Channel } from "@/types/domain";
import { Button } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useDialog } from "@/hooks/useDialog";
import { useChannelRuntime, channelKey } from "@/stores/channelRuntime";
import { cancelPairing, removeOwner, startPairing } from "@/lib/channelRuntime";
import { relativeTime } from "@/lib/format";

/** Paired phones, and pairing a new one. */
export function Owners({
  agent,
  channel,
  running,
  bot,
}: {
  agent: Agent;
  channel: Channel;
  running: boolean;
  bot: string;
}) {
  const key = channelKey(agent.id, channel.id);
  const pairing = useChannelRuntime((s) => s.pairing[key]);
  const { confirm } = useDialog();
  const owners = channel.owners ?? [];
  const [now, setNow] = useState(() => Date.now());

  // Count the code down; drop it when it expires.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => {
      const at = Date.now();
      if (pairing.expiresAt < at) cancelPairing(agent, channel);
      setNow(at);
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

  const left = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const pairTarget = channel.kind === "telegram" ? (bot ? `@${bot}` : "your bot") : "the Discord channel";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">Paired phones</span>
        {!pairing && (
          <Button
            variant="ghost"
            icon="plus"
            className="h-7 px-2"
            disabled={!running}
            onClick={() => startPairing(agent, channel)}
          >
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
            <code className="select-all font-mono text-2xl font-semibold tracking-[0.12em] text-ink">
              /pair {pairing.code}
            </code>
            <span className="font-mono text-xs text-ink-3">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </span>
          </div>
        </div>
      )}

      {owners.length === 0 && !pairing ? (
        <p className="text-xs text-ink-3">
          {running
            ? "No phone paired yet — nobody can use this bot until you pair one."
            : "Start the bot, then pair your phone."}
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
