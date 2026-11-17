import { useState } from "react";
import type { Agent, Channel } from "@/types/domain";
import { Button, Field } from "@/components/ui";
import { discordSend } from "@/lib/channelRuntime";
import { isDesktop } from "@/lib/platform";
import { errorMessage } from "@/lib/runError";

export function DiscordWebhook({ agent, channel, onSave }: { agent: Agent; channel: Channel; onSave: (url: string) => void }) {
  const [webhook, setWebhook] = useState(channel.config?.webhook ?? "");
  const [note, setNote] = useState("");
  const test = async () => {
    try {
      await discordSend(webhook, `✅ ${agent.name} is connected to this channel via Forge.`);
      setNote("Sent a test message.");
    } catch (e) {
      setNote(`Failed: ${errorMessage(e)}`);
    }
  };
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] text-ink-2">
        Outbound webhook <span className="text-xs text-ink-3">{channel.config?.webhook ? "set" : "optional"}</span>
      </summary>
      <div className="space-y-2 border-t border-border p-3">
        <Field label="Webhook URL" hint="Scheduled routines also post their results here.">
          <input
            className="input font-mono"
            placeholder="https://discord.com/api/webhooks/…"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
          />
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
