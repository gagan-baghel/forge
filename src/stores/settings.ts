import { create } from "zustand";
import { persist } from "zustand/middleware";
import { currentModel } from "@/types/domain";
import type { ModelId, RuntimeKind, Settings, ThemeName } from "@/types/domain";

interface SettingsStore extends Settings {
  setApiKey: (key: string) => void;
  setCcToken: (token: string) => void;
  setDefaultModel: (m: ModelId) => void;
  setRuntime: (r: RuntimeKind) => void;
  setTheme: (t: ThemeName) => void;
  setUserName: (n: string) => void;
  setKeepAwake: (on: boolean) => void;
  setPriceOverride: (model: string, price: { in: number; out: number }) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

const STORE_KEY = "forge.settings";

const initial: Settings = {
  apiKey: "",
  ccToken: "",
  defaultModel: "claude-opus-5",
  // Forge runs on the local Claude Code daemon by default — no connect step.
  runtime: "claude-code",
  theme: "dusk",
  userName: "",
  onboarded: false,
  keepAwake: true,
  priceOverrides: {},
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
      setKeepAwake: (keepAwake) => set({ keepAwake }),
      setPriceOverride: (model, price) =>
        set((s) => ({ priceOverrides: { ...s.priceOverrides, [model]: price } })),
      completeOnboarding: () => set({ onboarded: true }),
      reset: () => set(initial),
    }),
    {
      name: STORE_KEY,
      version: 2,
      // A retired defaultModel would price every new run at $0.
      migrate: (state: any) => ({
        keepAwake: true,
        ...state,
        defaultModel: currentModel(state?.defaultModel),
      }),
    },
  ),
);
