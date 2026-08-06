import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogProvider, useDialog } from "@/components/Confirm";

/**
 * These stand in for every destructive guard in the app. `window.confirm` is a
 * no-op in the desktop webview, so this path must work without it.
 */
function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const { confirm, notify } = useDialog();
  return (
    <>
      <button
        onClick={async () => onResult(await confirm({ title: "Delete it?", body: "Cannot be undone." }))}
      >
        danger
      </button>
      <button onClick={() => notify("Copied", "Share code is on the clipboard.")}>tell me</button>
    </>
  );
}

describe("in-app confirm", () => {
  it("resolves true when confirmed", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByRole("button", { name: "danger" }));
    expect(await screen.findByText("Delete it?")).toBeInTheDocument();
    expect(screen.getByText("Cannot be undone.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(results).toEqual([true]);
    expect(screen.queryByText("Delete it?")).not.toBeInTheDocument();
  });

  it("resolves false when cancelled — a dismissed dialog must not delete", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByRole("button", { name: "danger" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(results).toEqual([false]);
  });

  it("resolves false when dismissed with Escape", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByRole("button", { name: "danger" }));
    await user.keyboard("{Escape}");
    expect(results).toEqual([false]);
  });

  it("settles a confirm exactly once", async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    render(
      <DialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </DialogProvider>,
    );

    await user.click(screen.getByRole("button", { name: "danger" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}");

    expect(results).toEqual([true]);
  });

  it("shows a notification with only an OK button", async () => {
    const user = userEvent.setup();
    render(
      <DialogProvider>
        <Harness onResult={() => {}} />
      </DialogProvider>,
    );

    await user.click(screen.getByRole("button", { name: "tell me" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
