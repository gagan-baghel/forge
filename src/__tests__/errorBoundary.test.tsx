import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error("kaboom in a view");
  return <div>view content</div>;
}

/** Lets the test flip a child from throwing to healthy, then hit "Try again". */
function Harness() {
  const [explode, setExplode] = useState(true);
  return (
    <>
      <button onClick={() => setExplode(false)}>heal</button>
      <ErrorBoundary>
        <Boom explode={explode} />
      </ErrorBoundary>
    </>
  );
}

describe("ErrorBoundary", () => {
  it("catches a render throw and shows the message instead of a blank screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Something broke/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom in a view/i)).toBeInTheDocument();
  });

  it("offers a full reload only on the fatal (root) boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: /Reload Forge/i })).not.toBeInTheDocument();
    unmount();

    render(
      <ErrorBoundary fatal>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /Reload Forge/i })).toBeInTheDocument();
  });

  it("recovers via Try again once the child stops throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText(/Something broke/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /heal/i }));
    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByText("view content")).toBeInTheDocument();
    expect(screen.queryByText(/Something broke/i)).not.toBeInTheDocument();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("view content")).toBeInTheDocument();
    expect(screen.queryByText(/Something broke/i)).not.toBeInTheDocument();
  });
});
