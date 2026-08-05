import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelId, RuntimeKind, Settings, ThemeName } from "@/types/domain";
import { getSecret, setSecret } from "@/lib/secrets";

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

const STORE_KEY = "forge.settings";

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
      // Credentials are mirrored into the OS keychain, not the persisted blob.
      setApiKey: (apiKey) => {
        set({ apiKey });
        void setSecret("apiKey", apiKey);
      },
      setCcToken: (ccToken) => {
        set({ ccToken });
        void setSecret("ccToken", ccToken);
      },
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setRuntime: (runtime) => set({ runtime }),
      setTheme: (theme) => set({ theme }),
      setUserName: (userName) => set({ userName }),
      completeOnboarding: () => set({ onboarded: true }),
      reset: () => {
        set(initial);
        void setSecret("apiKey", "");
        void setSecret("ccToken", "");
      },
    }),
    {
      name: STORE_KEY,
      // Keep credentials out of localStorage entirely; they live in the keychain.
      partialize: ({ apiKey: _apiKey, ccToken: _ccToken, ...rest }) => rest,
    },
  ),
);

/**
 * Pull credentials from the keychain into the store. Must run before anything
 * reads `apiKey`, so it is awaited at boot in main.tsx.
 *
 * Also migrates installs from before keychain storage: older builds persisted
 * the key in the settings blob, so it gets moved across and the plaintext copy
 * stripped, once.
 */
export async function hydrateSecrets(): Promise<void> {
  let legacyApiKey = "";
  let legacyCcToken = "";

  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const state = parsed?.state;
      if (state && (state.apiKey || state.ccToken)) {
        legacyApiKey = state.apiKey ?? "";
        legacyCcToken = state.ccToken ?? "";
        delete state.apiKey;
        delete state.ccToken;
        localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
      }
    }
  } catch {
    // A malformed blob is not worth failing boot over.
  }

  if (legacyApiKey) await setSecret("apiKey", legacyApiKey).catch(() => {});
  if (legacyCcToken) await setSecret("ccToken", legacyCcToken).catch(() => {});

  const [apiKey, ccToken] = await Promise.all([getSecret("apiKey"), getSecret("ccToken")]);
  useSettings.setState({ apiKey, ccToken });
}
