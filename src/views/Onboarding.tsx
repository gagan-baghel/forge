import { useState } from "react";
import { useSettings } from "@/stores/settings";
import { MODELS } from "@/types/domain";
import { Button, Field } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ForgeMark } from "@/components/Shell";

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
    <div className="grid h-screen w-screen place-items-center overflow-y-auto bg-bg p-6" data-tauri-drag-region>
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <ForgeMark size={36} />
          <h1 className="mt-5 text-lg font-semibold tracking-tight">Welcome to Forge</h1>
          <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-3">
            Build, run and share AI agents as GAPs — Global Agent Packs. Local-first, your keys, your machine.
          </p>
        </div>

        <div className="card space-y-5 p-6">
          <div className="flex items-center justify-between text-[11px] text-ink-3">
            <span>{step === 0 ? "About you" : "Runtime & model"}</span>
            <span className="flex items-center gap-1" aria-label={`Step ${step + 1} of 2`}>
              {[0, 1].map((i) => (
                <span key={i} className={`h-1 w-5 rounded-full ${i <= step ? "bg-ink-2" : "bg-surface-3"}`} />
              ))}
            </span>
          </div>
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
                Continue <Icon name="chevron" size={14} />
              </Button>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2/60 px-3 py-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
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
                <div className="space-y-1.5">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      aria-pressed={model === m.id}
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
                        model === m.id ? "border-border-strong bg-surface-2" : "border-border hover:bg-surface-2/50"
                      }`}
                    >
                      <span
                        className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                          model === m.id ? "border-ink" : "border-border-strong"
                        }`}
                      >
                        {model === m.id && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{m.label}</span>
                        <span className="ml-2 text-xs text-ink-3">{m.blurb}</span>
                      </span>
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
