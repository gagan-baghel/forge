import { useState } from "react";
import clsx from "clsx";
import type { Channel } from "@/types/domain";
import { Button, Field } from "@/components/ui";
import type { ChannelKind } from "./provider";

export function CredentialsForm({
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
            <input
              className="input font-mono"
              placeholder="123456789012345678"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
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
