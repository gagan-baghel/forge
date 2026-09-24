import { useMemo, useState } from "react";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ChannelCard, type ChannelKind } from "@/components/remote/ChannelCard";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { useChannelRuntime, channelKey, type RemoteActivity } from "@/stores/channelRuntime";
import { answerApproval, syncKeepAwake } from "@/lib/channelRuntime";
import { invoke, isDesktop } from "@/lib/platform";
import { relativeTime } from "@/lib/format";

/**
 * The phone side of Forge in one place: which agents are reachable, who is
 * paired, what is waiting for approval, and what happened.
 */
export function RemoteView() {
  const gaps = useGaps((s) => s.gaps);
  const running = useChannelRuntime((s) => s.running);
  const approvals = useChannelRuntime((s) => s.approvals);
  const activity = useChannelRuntime((s) => s.activity);
  const keepAwake = useSettings((s) => s.keepAwake);
  const setKeepAwake = useSettings((s) => s.setKeepAwake);
  const [connectOpen, setConnectOpen] = useState(false);

  const agents = useMemo(() => gaps.flatMap((g) => g.agents), [gaps]);
  const connections = useMemo(
    () =>
      agents.flatMap((a) =>
        a.channels
          .filter((c) => (c.kind === "telegram" || c.kind === "discord") && c.token)
          .map((c) => ({ agent: a, kind: c.kind as ChannelKind, key: channelKey(a.id, c.id), channel: c })),
      ),
    [agents],
  );
  const live = connections.filter((c) => running[c.key]).length;
  const phones = connections.reduce((n, c) => n + (c.channel.owners?.length ?? 0), 0);
  const remoteOn = connections.filter((c) => c.channel.remoteControl).length;
  const agentName = (key: string) => agents.find((a) => key.startsWith(`${a.id}__`))?.name ?? "Agent";

  return (
    <div>
      <PageHeader
        title="Remote"
        subtitle="Message your agents from your phone — they work on this Mac and ask you before acting"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setConnectOpen(true)} disabled={agents.length === 0}>
            Connect an agent
          </Button>
        }
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon="bolt" label="Live bots" value={`${live}`} sub={`of ${connections.length} connected`} tone={live ? "success" : undefined} />
          <Stat icon="phone" label="Paired phones" value={`${phones}`} sub={phones ? "only they can reach agents" : "pair one to start"} />
          <Stat icon="shield" label="Remote control" value={`${remoteOn}`} sub={remoteOn === 1 ? "agent may act on this Mac" : "agents may act on this Mac"} />
          <Stat
            icon="lock"
            label="Waiting on you"
            value={`${approvals.length}`}
            sub={approvals.length ? "approvals pending" : "nothing pending"}
            tone={approvals.length ? "warn" : undefined}
          />
        </div>

        {approvals.length > 0 && (
          <Card className="border-warn/30">
            <CardHeader title="Waiting for approval" hint="Answered here or on the phone — whichever comes first." />
            <ul className="divide-y divide-border">
              {approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{a.title}</div>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-2">{a.body}</pre>
                    <div className="mt-1 text-[11px] text-ink-3">
                      {agentName(a.key)} · {relativeTime(a.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => answerApproval(a.id, "no")}>
                      Deny
                    </Button>
                    <Button onClick={() => answerApproval(a.id, "trust")}>Allow 15 min</Button>
                    <Button variant="primary" onClick={() => answerApproval(a.id, "ok")}>
                      Approve
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {connections.length === 0 ? (
              <Card>
                <EmptyState
                  icon="phone"
                  title="No agent is reachable from your phone yet"
                  body="Connect an agent to a Telegram or Discord bot, pair your phone, and message it from anywhere."
                  action={
                    <Button variant="primary" icon="plus" onClick={() => setConnectOpen(true)} disabled={agents.length === 0}>
                      Connect an agent
                    </Button>
                  }
                />
                <HowItWorks />
              </Card>
            ) : (
              connections.map((c) => <ChannelCard key={c.key} agent={c.agent} kind={c.kind} showAgent />)
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="This Mac" hint="What remote work needs from the computer." />
              <div className="space-y-4">
                <Toggle
                  checked={keepAwake}
                  onChange={(on) => {
                    setKeepAwake(on);
                    setTimeout(syncKeepAwake);
                  }}
                  label="Keep awake while remote control is live"
                  description="A sleeping Mac can't answer. Closing the window keeps Forge running; ⌘Q quits."
                />
                <Permissions />
              </div>
            </Card>

            <Card className="p-0">
              <div className="px-5 pt-5">
                <CardHeader title="Activity" hint="Messages, approvals and security events this session." />
              </div>
              {activity.length === 0 ? (
                <p className="px-5 pb-5 text-xs text-ink-3">Nothing yet.</p>
              ) : (
                <ul className="max-h-[420px] overflow-y-auto border-t border-border">
                  {activity.map((e, i) => (
                    <ActivityRow key={`${e.at}-${i}`} entry={e} agent={agentName(e.key)} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </PageBody>

      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}

function Stat({ icon, label, value, sub, tone }: { icon: string; label: string; value: string; sub: string; tone?: "success" | "warn" }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <Icon name={icon} size={13} />
        {label}
      </div>
      <div className={clsx("mt-1.5 text-xl font-semibold tabular-nums", tone === "success" && "text-success", tone === "warn" && "text-warn")}>
        {value}
      </div>
      <div className="truncate text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

const KIND_ICON: Record<RemoteActivity["kind"], string> = {
  in: "arrowRight",
  out: "send",
  approval: "lock",
  security: "shield",
  system: "info",
};

function ActivityRow({ entry, agent }: { entry: RemoteActivity; agent: string }) {
  return (
    <li className="flex gap-3 border-b border-border px-5 py-2.5 last:border-0">
      <Icon
        name={KIND_ICON[entry.kind]}
        size={13}
        className={clsx("mt-0.5 shrink-0", entry.kind === "security" ? "text-warn" : "text-ink-3")}
      />
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs text-ink-2">{entry.text}</div>
        <div className="text-[11px] text-ink-3">
          {agent} · {relativeTime(entry.at)}
        </div>
      </div>
    </li>
  );
}

const PANES = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

function Permissions() {
  const open = (pane: keyof typeof PANES) => void invoke("shell_exec", { command: `open "${PANES[pane]}"` }).catch(() => {});
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="text-xs text-ink-3">
        To see the screen and click or type, macOS needs to allow Forge once:
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="h-7 px-2 text-xs" icon="monitor" disabled={!isDesktop()} onClick={() => open("screen")}>
          Screen Recording
        </Button>
        <Button className="h-7 px-2 text-xs" icon="command" disabled={!isDesktop()} onClick={() => open("accessibility")}>
          Accessibility
        </Button>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: "link", title: "Connect", body: "Give an agent a Telegram or Discord bot — paste its token." },
    { icon: "phone", title: "Pair", body: "Send the one-time /pair code from your phone. Strangers are ignored." },
    { icon: "shield", title: "Approve", body: "Ask for anything. Each action on this Mac waits for your tap." },
  ];
  return (
    <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
      {steps.map((s, i) => (
        <div key={s.title} className="rounded-lg border border-border bg-surface-2/40 p-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className="font-mono text-[11px] text-ink-3">{i + 1}</span>
            <Icon name={s.icon} size={14} className="text-ink-2" />
            {s.title}
          </div>
          <p className="mt-1 text-xs text-ink-3">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gaps = useGaps((s) => s.gaps);
  const agents = gaps.flatMap((g) => g.agents);
  const [agentId, setAgentId] = useState("");
  const [kind, setKind] = useState<ChannelKind>("telegram");
  const agent = agents.find((a) => a.id === (agentId || agents[0]?.id));

  return (
    <Modal open={open} onClose={onClose} title="Connect an agent to your phone" width={620}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Agent">
            <select className="input" value={agent?.id ?? ""} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name} — {a.role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Via">
            <div className="flex h-[30px] rounded-md border border-border p-0.5">
              {(["telegram", "discord"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={clsx(
                    "rounded px-3 text-xs capitalize transition-colors",
                    kind === k ? "bg-surface-3 font-medium text-ink" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {agent && (
          <>
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <Avatar emoji={agent.emoji} size={20} /> {agent.name}'s {kind} bot
              {agent.channels.some((c) => c.kind === kind && c.token) && <Badge tone="success">already connected</Badge>}
            </div>
            <ChannelCard key={`${agent.id}-${kind}`} agent={agent} kind={kind} />
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
