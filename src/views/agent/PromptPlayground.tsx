import { useState } from "react";
import type { Agent } from "@/types/domain";
import { Button, Card, Field, Spinner, Badge } from "@/components/ui";
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
    <div className="h-full overflow-y-auto p-7">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Playground</h3>
            <span className="text-xs text-ink-3">Isolated · doesn't save to chat history</span>
          </div>
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
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-3">⌘/Ctrl + Enter to run</span>
            <Button variant="primary" icon="spark" onClick={run} disabled={busy || !input.trim()}>
              {busy ? <><Spinner size={14} /> Running…</> : "Run"}
            </Button>
          </div>
        </Card>

        {(output || error || busy) && (
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Output</h3>
              {meta && (
                <div className="flex gap-2">
                  <Badge>{fmtTokens(meta.tokens)} tok</Badge>
                  <Badge>{fmtUsd(meta.cost)}</Badge>
                </div>
              )}
            </div>
            {error ? (
              <div className="text-sm text-danger">{error}</div>
            ) : output ? (
              <Markdown content={output} />
            ) : (
              <Spinner size={16} />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
