import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { resetStores } from "@/test/reset";
import { useSettings } from "@/stores/settings";

beforeEach(() => resetStores());

describe("app onboarding → workspace (end to end)", () => {
  it("walks through onboarding and lands in the workspace", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Step 0 — name.
    expect(screen.getByText(/Welcome to Forge/i)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Ada"), "Grace");
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    // Step 2 — runtime/key. Finish without a key.
    await user.click(screen.getByRole("button", { name: /Enter Forge/i }));

    // We are now in the workspace.
    expect(await screen.findByText(/Welcome back, Grace/i)).toBeInTheDocument();
    expect(useSettings.getState().onboarded).toBe(true);
  });

  it("opens the command palette and lists destinations", async () => {
    useSettings.setState({ onboarded: true, userName: "Grace" });
    render(<App />);
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("forge:command-open"));
    });

    const palette = await screen.findByTestId("command-palette");
    expect(within(palette).getByPlaceholderText(/Jump to anything/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(palette).getByText("Marketplace")).toBeInTheDocument();
      expect(within(palette).getByText("Settings")).toBeInTheDocument();
    });
  });
});
