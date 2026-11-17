import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PROVIDER, type ChannelKind } from "./provider";

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

export function SetupGuide({ kind }: { kind: ChannelKind }) {
  const [open, setOpen] = useState(false);
  const title = `Set up ${PROVIDER[kind].name}`;
  return (
    <>
      <button
        className="btn-ghost h-7 px-1.5 text-ink-3"
        onClick={() => setOpen(true)}
        aria-label={`How to set up ${PROVIDER[kind].name}`}
        title={title}
      >
        <Icon name="info" size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 text-[13px] text-ink-2">
          {kind === "telegram" ? (
            <>
              <Step n={1}>
                In Telegram, open <strong className="text-ink">@BotFather</strong> and send{" "}
                <code className="font-mono">/newbot</code>.
              </Step>
              <Step n={2}>Pick a display name, then a username ending in “bot”.</Step>
              <Step n={3}>
                Copy the token BotFather sends (<code className="font-mono">123456:ABC…</code>), paste it here, and
                press <strong className="text-ink">Connect &amp; start</strong>.
              </Step>
              <Step n={4}>
                Press <strong className="text-ink">Pair a phone</strong>, then send the{" "}
                <code className="font-mono">/pair</code> code to your bot from Telegram. Only paired phones can use it.
              </Step>
              <Step n={5}>
                Turn on <strong className="text-ink">Remote control</strong> if this agent should be able to act on this
                Mac. Every action asks your phone first.
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
                In <strong className="text-ink">OAuth2 → URL Generator</strong> tick <em>bot</em> with{" "}
                <em>View Channels</em>, <em>Send Messages</em>, <em>Attach Files</em>, <em>Read Message History</em>;
                open the URL to invite it.
              </Step>
              <Step n={4}>
                Enable Developer Mode (Settings → Advanced), right-click the channel →{" "}
                <strong className="text-ink">Copy Channel ID</strong>.
              </Step>
              <Step n={5}>
                Paste both here, <strong className="text-ink">Connect &amp; start</strong>, then pair: post the{" "}
                <code className="font-mono">/pair</code> code in that channel. Approvals are answered by replying yes,
                trust or no.
              </Step>
            </>
          )}
          <p className="text-xs text-ink-3">
            Tokens stay on this device. They are removed from exported packs and backups.
          </p>
        </div>
      </Modal>
    </>
  );
}
