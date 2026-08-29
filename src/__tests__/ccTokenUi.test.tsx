import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SettingsView } from "@/views/Settings";
import { DialogProvider } from "@/components/Confirm";
import { useSettings } from "@/stores/settings";
import { resetStores } from "@/test/reset";

// Pretend the CLI is installed and we're on desktop — the token field is
// pointless on web (no CLI to authenticate) and is deliberately hidden there.
vi.mock("@/hooks/useClaudeCode", () => ({
  useClaudeCode: () => ({
    info: { available: true, version: "2.1.175" },
    available: true,
    desktop: true,
    install: vi.fn(),
    installing: false,
    installLog: [],
    installError: "",
  }),
}));

beforeEach(() => {
  resetStores();
  vi.spyOn(useSettings.getState(), "setCcToken");
});

const ui = (
  <MemoryRouter>
    <DialogProvider>
      <SettingsView />
    </DialogProvider>
  </MemoryRouter>
);

/**
 * Regression guard: the UI for this token was deleted in the standalone
 * refactor while the plumbing stayed, so `ccToken` was permanently empty and
 * every Claude Code agent run 401'd. If this test fails, that bug is back.
 */
describe("background-run token settings", () => {
  it("offers a way to save the token, and tells the user how to mint one", async () => {
    render(ui);
    expect(screen.getByText("Background-run token")).toBeInTheDocument();
    expect(screen.getByText("claude setup-token")).toBeInTheDocument();
    // The affordance that was missing entirely: somewhere to put the token.
    expect(screen.getByPlaceholderText(/sk-ant-oat/)).toBeInTheDocument();
  });

  it("saves a pasted token into settings", async () => {
    const user = userEvent.setup();
    render(ui);

    await user.type(screen.getByPlaceholderText(/sk-ant-oat/), "sk-ant-oat-abc123");
    await user.click(screen.getAllByRole("button", { name: "Save" })[1]);

    expect(useSettings.getState().ccToken).toBe("sk-ant-oat-abc123");
    expect(await screen.findByText("connected")).toBeInTheDocument();
  });
});
