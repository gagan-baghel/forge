import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, Spinner } from "@/components/ui";

describe("dialog accessibility", () => {
  it("exposes the modal as a labelled dialog", () => {
    render(
      <Modal open onClose={() => {}} title="Delete it?">
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Delete it?");
  });

  it("returns focus to whatever opened it", () => {
    // Without this, dismissing a dialog drops focus to the top of the page.
    const btn = document.createElement("button");
    btn.textContent = "opener";
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);

    const { unmount } = render(
      <Modal open onClose={() => {}} title="X">
        <p>b</p>
      </Modal>,
    );
    unmount();
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    let closed = false;
    render(
      <Modal open onClose={() => (closed = true)} title="X">
        <p>b</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(closed).toBe(true);
  });
});

describe("busy state accessibility", () => {
  it("announces the spinner rather than rendering a silent graphic", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Working");
  });

  it("takes a specific label when the context is known", () => {
    render(<Spinner label="Designing your pack" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Designing your pack");
  });
});
