import { useState } from "react";
import type { Agent } from "@/types/domain";
import { Button, Card, CardHeader, Field, Spinner, Badge } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { runAgentHeadless } from "@/lib/agentRun";
import { fmtUsd, fmtTokens } from "@/lib/format";

/**
 * Prompt playground — fire a one-off message at the agent without touching its
 * conversation history. Handy for testing a system prompt or a tool quickly.
 */
export function PromptPlayground({ agent }: { agent: Agent }) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [meta, setMeta] = useState<{ tokens: number; cost: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setOutput("");
    setMeta(null);
    setError("");
    try {
      const result = await runAgentHeadless(agent, input.trim(), { onText: (d) => setOutput((o) => o + d) });
      if (!output && result.text) setOutput(result.text);
      setMeta({ tokens: result.inputTokens + result.outputTokens, cost: result.costUsd });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <Card>
          <CardHeader title="Playground" hint="Isolated · doesn't save to chat history" />
          <Field label="Message">
            <textarea
              className="input min-h-[120px] resize-y"
              autoFocus
              placeholder={`Ask ${agent.name} something…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
              }}
            />
          </Field>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-ink-3">
              <kbd className="kbd">⌘</kbd>/<kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Enter</kbd> to run
            </span>
            <Button variant="primary" icon={busy ? undefined : "play"} onClick={run} disabled={busy || !input.trim()}>
              {busy ? <><Spinner size={14} /> Running…</> : "Run"}
            </Button>
          </div>
        </Card>

        {(output || error || busy) && (
          <Card>
            <CardHeader
              title="Output"
              action={
                meta && (
                  <div className="flex gap-1.5">
                    <Badge>{fmtTokens(meta.tokens)} tok</Badge>
                    <Badge>{fmtUsd(meta.cost)}</Badge>
                  </div>
                )
              }
            />
            {error ? (
              <div className="text-[13px] text-danger">{error}</div>
            ) : output ? (
              <div className="text-[13px] leading-relaxed">
                <Markdown content={output} />
              </div>
            ) : (
              <Spinner size={16} />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
