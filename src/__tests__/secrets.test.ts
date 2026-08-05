import { describe, it, expect, beforeEach } from "vitest";
import { useSettings, hydrateSecrets } from "@/stores/settings";
import { getSecret } from "@/lib/secrets";
import { resetStores } from "@/test/reset";

// jsdom is not the desktop build, so secrets fall back to the localStorage
// namespace — which is exactly what lets us assert where they end up.
const STORE_KEY = "forge.settings";

beforeEach(() => {
  resetStores();
  localStorage.clear();
});

describe("credential storage", () => {
  it("keeps the api key out of the persisted settings blob", async () => {
    useSettings.getState().setApiKey("sk-ant-secret");

    const blob = localStorage.getItem(STORE_KEY) ?? "";
    expect(blob).not.toContain("sk-ant-secret");
    expect(JSON.parse(blob).state).not.toHaveProperty("apiKey");

    // …but it is still readable through the secret store.
    expect(await getSecret("apiKey")).toBe("sk-ant-secret");
  });

  it("migrates a legacy plaintext key out of the blob and into the keychain", async () => {
    // Simulate an install from before keychain storage.
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        state: { apiKey: "sk-ant-legacy", ccToken: "cc-legacy", theme: "dusk", onboarded: true },
        version: 0,
      }),
    );

    await hydrateSecrets();

    const blob = localStorage.getItem(STORE_KEY) ?? "";
    expect(blob).not.toContain("sk-ant-legacy");
    expect(blob).not.toContain("cc-legacy");

    expect(useSettings.getState().apiKey).toBe("sk-ant-legacy");
    expect(useSettings.getState().ccToken).toBe("cc-legacy");
    expect(await getSecret("apiKey")).toBe("sk-ant-legacy");
  });

  it("survives a malformed settings blob without throwing", async () => {
    localStorage.setItem(STORE_KEY, "{not json");
    await expect(hydrateSecrets()).resolves.toBeUndefined();
  });

  it("clears stored credentials on reset", async () => {
    useSettings.getState().setApiKey("sk-ant-gone");
    expect(await getSecret("apiKey")).toBe("sk-ant-gone");

    useSettings.getState().reset();
    expect(await getSecret("apiKey")).toBe("");
  });
});
