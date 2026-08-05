import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelId, RuntimeKind, Settings, ThemeName } from "@/types/domain";

interface SettingsStore extends Settings {
  setApiKey: (key: string) => void;
  setCcToken: (token: string) => void;
  setDefaultModel: (m: ModelId) => void;
  setRuntime: (r: RuntimeKind) => void;
  setTheme: (t: ThemeName) => void;
  setUserName: (n: string) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

const initial: Settings = {
  apiKey: "",
  ccToken: "",
  defaultModel: "claude-opus-4-8",
  // Forge runs on the local Claude Code daemon by default — no connect step.
  runtime: "claude-code",
  theme: "dusk",
  userName: "",
  onboarded: false,
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initial,
      setApiKey: (apiKey) => set({ apiKey }),
      setCcToken: (ccToken) => set({ ccToken }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setRuntime: (runtime) => set({ runtime }),
      setTheme: (theme) => set({ theme }),
      setUserName: (userName) => set({ userName }),
      completeOnboarding: () => set({ onboarded: true }),
      reset: () => set(initial),
    }),
    { name: "forge.settings" },
  ),
);
