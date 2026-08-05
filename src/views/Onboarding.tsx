import { useState } from "react";
import { useSettings } from "@/stores/settings";
import { MODELS } from "@/types/domain";
import { Button, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";

/**
 * First-run onboarding. Collects a display name, the Claude API key, and a
 * default model, then drops the user into the workspace with starter GAPs
 * already installed.
 */
export function OnboardingView() {
  const { setApiKey, setUserName, setDefaultModel, completeOnboarding } = useSettings();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [step, setStep] = useState(0);

  const finish = () => {
    if (name.trim()) setUserName(name.trim());
    if (key.trim()) setApiKey(key.trim());
    setDefaultModel(model);
    completeOnboarding();
  };

  return (
    <div className="grid h-screen w-screen place-items-center bg-bg p-6" data-theme="dusk">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-glow">
            <span className="font-mono text-xl font-bold">F</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Forge</h1>
          <p className="mt-1 text-sm text-ink-2">
            Build, run and share AI agents as GAPs — Global Agent Packs. Local-first, your keys, your machine.
          </p>
        </div>

        <div className="card space-y-5 p-6">
          {step === 0 && (
            <>
              <Field label="Your name" hint="Used to personalize the workspace.">
                <input
                  className="input"
                  value={name}
                  autoFocus
                  placeholder="Ada"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setStep(1)}
                />
              </Field>
              <Button variant="primary" className="w-full" onClick={() => setStep(1)}>
                Continue <Icon name="chevron" size={16} />
              </Button>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.07] px-3 py-2.5">
                <Icon name="bolt" size={16} className="mt-0.5 shrink-0 text-success" />
                <p className="text-xs text-ink-2">
                  Forge runs on your <span className="font-medium text-ink">local Claude Code</span> automatically — no
                  key, nothing metered. An API key below is optional, only if you'd rather use metered API calls.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-ink-3">optional API key</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Field
                label="Claude API key"
                hint="Optional. Stored locally on this device only. Get one at console.anthropic.com. You can add it later in Settings."
              >
                <input
                  className="input font-mono"
                  type="password"
                  value={key}
                  autoFocus
                  placeholder="sk-ant-…"
                  onChange={(e) => setKey(e.target.value)}
                />
              </Field>
              <Field label="Default model">
                <div className="space-y-2">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        model === m.id ? "border-brand bg-brand/10" : "border-border hover:bg-surface-2"
                      }`}
                    >
                      <span>
                        <span className="font-medium">{m.label}</span>
                        <span className="ml-2 text-xs text-ink-3">{m.blurb}</span>
                      </span>
                      {model === m.id && <Icon name="check" size={16} className="text-brand-2" />}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="primary" className="flex-1" onClick={finish}>
                  Enter Forge
                </Button>
              </div>
              <button className="w-full text-center text-xs text-ink-3 hover:text-ink-2" onClick={finish}>
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
