import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogProvider } from "@/components/Confirm";
import { TeamView } from "@/views/Team";
import { useTeam } from "@/stores/team";

/**
 * Destructive buttons must route through the confirm dialog. The trash icons
 * are one click with no undo behind them, so a regression here is silent data
 * loss — the button keeps working, it just stops asking.
 *
 * TeamView stands in for the whole set (skills, knowledge, connectors,
 * channels, team members): they all share the same useDialog() guard.
 */
describe("destructive actions ask first", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useTeam.setState({ members: [] }));
  });

  const renderWithMember = () => {
    act(() => {
      useTeam.getState().add({ name: "Ada", email: "ada@example.com", role: "member" });
    });
    render(
      <DialogProvider>
        <TeamView />
      </DialogProvider>,
    );
  };

  it("keeps the member when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderWithMember();

    await user.click(screen.getByRole("button", { name: "Remove Ada" }));
    expect(await screen.findByText("Remove Ada?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useTeam.getState().members).toHaveLength(1);
  });

  it("removes the member only after confirming", async () => {
    const user = userEvent.setup();
    renderWithMember();

    await user.click(screen.getByRole("button", { name: "Remove Ada" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(useTeam.getState().members).toHaveLength(0);
  });
});
