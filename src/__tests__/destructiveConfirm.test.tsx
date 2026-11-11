import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DialogProvider } from "@/components/Confirm";
import { SchedulesView } from "@/views/Schedules";
import { useRoutines } from "@/stores/routines";
import { resetStores } from "@/test/reset";

/**
 * Destructive buttons must route through the confirm dialog. The trash icons
 * are one click with no undo behind them, so a regression here is silent data
 * loss — the button keeps working, it just stops asking.
 *
 * Deleting a routine stands in for the whole set (skills, knowledge,
 * connectors, channels, memories): they all share the same useDialog() guard.
 */
describe("destructive actions ask first", () => {
  beforeEach(() => resetStores());

  const renderWithRoutine = () => {
    act(() => {
      useRoutines.getState().add({ name: "Digest", agentId: "a", agentName: "A", cron: "0 9 * * *", prompt: "", enabled: true });
    });
    render(
      <MemoryRouter>
        <DialogProvider>
          <SchedulesView />
        </DialogProvider>
      </MemoryRouter>,
    );
  };

  it("keeps the routine when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderWithRoutine();

    await user.click(screen.getByRole("button", { name: "Delete routine" }));
    expect(await screen.findByText('Delete routine "Digest"?')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useRoutines.getState().routines).toHaveLength(1);
  });

  it("deletes the routine only after confirming", async () => {
    const user = userEvent.setup();
    renderWithRoutine();

    await user.click(screen.getByRole("button", { name: "Delete routine" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(useRoutines.getState().routines).toHaveLength(0);
  });
});
