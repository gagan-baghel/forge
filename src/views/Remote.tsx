import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { PageBody, PageHeader } from "@/components/Shell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Toggle } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ChannelCard, type ChannelKind } from "@/components/remote/ChannelCard";
import { useGaps } from "@/stores/gaps";
import { useSettings } from "@/stores/settings";
import { useChannelRuntime, channelKey, type RemoteActivity } from "@/stores/channelRuntime";
import { answerApproval, hostChannels, isPack, syncKeepAwake, type Host } from "@/lib/channelRuntime";
import { invoke, isDesktop } from "@/lib/platform";
import { relativeTime } from "@/lib/format";

/**
 * The phone side of Forge in one place: which packs and agents are reachable,
 * who is paired, what is waiting for approval, and what happened. Packs and
 * agents each get their own section; every bot is one row that opens on tap.
 */
export function RemoteView() {
  const gaps = useGaps((s) => s.gaps);
  const running = useChannelRuntime((s) => s.running);
  const approvals = useChannelRuntime((s) => s.approvals);
  const activity = useChannelRuntime((s) => s.activity);
  const keepAwake = useSettings((s) => s.keepAwake);
  const setKeepAwake = useSettings((s) => s.setKeepAwake);
  const [params, setParams] = useSearchParams();
  // An agent page links here with ?agent=<id> (a pack with ?pack=<id>): open its phone setup.
  const preselect = params.get("agent") ?? params.get("pack") ?? "";
  // Arriving with ?agent= opens the dialog; closing it clears the param.
  const [opened, setConnectOpen] = useState(false);
  const connectOpen = opened || !!preselect;
  const closeConnect = () => {
    setConnectOpen(false);
    if (preselect) setParams({}, { replace: true });
  };

  const agents = useMemo(() => gaps.flatMap((g) => g.agents), [gaps]);
  const hosts = useMemo<Host[]>(() => [...gaps, ...agents], [gaps, agents]);
  const connections = useMemo(
    () =>
      hosts.flatMap((h) =>
        hostChannels(h)
          .filter((c) => (c.kind === "telegram" || c.kind === "discord") && c.token)
          .map((c) => ({ host: h, kind: c.kind as ChannelKind, key: channelKey(h.id, c.id), channel: c })),
      ),
    [hosts],
  );
  const packBots = connections.filter((c) => isPack(c.host));
  const agentBots = connections.filter((c) => !isPack(c.host));
  const live = connections.filter((c) => running[c.key]).length;
  const phones = connections.reduce((n, c) => n + (c.channel.owners?.length ?? 0), 0);
  const remoteOn = connections.filter((c) => c.channel.remoteControl).length;
  const agentName = (key: string) => hosts.find((h) => key.startsWith(`${h.id}__`))?.name ?? "Bot";

  return (
    <div>
      <PageHeader
        title="Remote"
        subtitle="Message a pack or an agent from your phone — they work on this Mac and ask you before acting"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setConnectOpen(true)} disabled={gaps.length === 0}>
            Connect
          </Button>
        }
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon="bolt"
            label="Live bots"
            value={`${live}`}
            sub={`of ${connections.length} connected`}
            tone={live ? "success" : undefined}
          />
          <Stat
            icon="phone"
            label="Paired phones"
            value={`${phones}`}
            sub={phones ? "only they can reach your bots" : "pair one to start"}
          />
          <Stat
            icon="shield"
            label="Remote control"
            value={`${remoteOn}`}
            sub={remoteOn === 1 ? "bot may act on this Mac" : "bots may act on this Mac"}
          />
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
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-2">
                      {a.body}
                    </pre>
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
                  title="Nothing is reachable from your phone yet"
                  body="Connect a pack or an agent to a Telegram or Discord bot, pair your phone, and message it from anywhere. A pack's bot reaches the whole team: the right agent answers, and @Name picks one."
                  action={
                    <Button
                      variant="primary"
                      icon="plus"
                      onClick={() => setConnectOpen(true)}
                      disabled={gaps.length === 0}
                    >
                      Connect
                    </Button>
                  }
                />
                <HowItWorks />
              </Card>
            ) : (
              <>
                <BotSection
                  title="Packs"
                  hint="The whole team on one bot: the right agent answers, @Name picks one."
                  bots={packBots}
                />
                <BotSection title="Agents" hint="One agent on its own bot." bots={agentBots} />
              </>
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

      <ConnectModal key={preselect} open={connectOpen} onClose={closeConnect} initialAgentId={preselect} />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  tone?: "success" | "warn";
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <Icon name={icon} size={13} />
        {label}
      </div>
      <div
        className={clsx(
          "mt-1.5 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warn" && "text-warn",
        )}
      >
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
  const open = (pane: keyof typeof PANES) =>
    void invoke("shell_exec", { command: `open "${PANES[pane]}"` }).catch(() => {});
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="text-xs text-ink-3">To see the screen and click or type, macOS needs to allow Forge once:</div>
      <div className="flex flex-wrap gap-2">
        <Button className="h-7 px-2 text-xs" icon="monitor" disabled={!isDesktop()} onClick={() => open("screen")}>
          Screen Recording
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          icon="command"
          disabled={!isDesktop()}
          onClick={() => open("accessibility")}
        >
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

function BotSection({
  title,
  hint,
  bots,
}: {
  title: string;
  hint: string;
  bots: { host: Host; kind: ChannelKind; key: string }[];
}) {
  if (bots.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="num text-[11px] text-ink-3">{bots.length}</span>
        <span className="truncate text-xs text-ink-3">{hint}</span>
      </div>
      {bots.map((c) => (
        <ChannelCard key={c.key} host={c.host} kind={c.kind} />
      ))}
    </section>
  );
}

function ConnectModal({
  open,
  onClose,
  initialAgentId = "",
}: {
  open: boolean;
  onClose: () => void;
  /** A pack's or an agent's id to open on. */
  initialAgentId?: string;
}) {
  const gaps = useGaps((s) => s.gaps);
  const hosts: Host[] = [...gaps, ...gaps.flatMap((g) => g.agents)];
  // Keyed on initialAgentId by the parent, so a new preselect starts fresh.
  const [hostId, setHostId] = useState(initialAgentId);
  const [kind, setKind] = useState<ChannelKind>("telegram");
  const host = hosts.find((h) => h.id === (hostId || gaps[0]?.id));

  return (
    <Modal open={open} onClose={onClose} title="Connect to your phone" width={620}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Who it reaches">
            <select className="input" value={host?.id ?? ""} onChange={(e) => setHostId(e.target.value)}>
              {gaps.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  <option value={g.id}>Whole pack — {g.agents.map((a) => a.name).join(", ") || "no agents yet"}</option>
                  {g.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} only — {a.role}
                    </option>
                  ))}
                </optgroup>
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
        {host && (
          <>
            {hostChannels(host).some((c) => c.kind === kind && c.token) && (
              <Badge tone="success">already connected</Badge>
            )}
            <ChannelCard key={`${host.id}-${kind}`} host={host} kind={kind} open />
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
