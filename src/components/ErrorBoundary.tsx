import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";
import { Icon } from "./Icon";

/**
 * Catches render/lifecycle throws so one bad view can't blank the whole window.
 * Desktop has no "reload the tab" reflex, so a crash must stay recoverable
 * from inside the app.
 *
 * Used twice: once at the root (last resort) and once per route, keyed on
 * location so navigating away clears a crashed screen on its own.
 */
interface Props {
  children: ReactNode;
  /** Shown above the message; defaults to a generic app-level title. */
  title?: string;
  /** Root boundary has no surviving chrome, so it offers a full reload. */
  fatal?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack somewhere a user can find it when reporting a bug.
    console.error("[forge] render error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { title = "Something broke", fatal } = this.props;
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-lg">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/12 text-danger">
              <Icon name="info" size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-ink-3">
                This screen hit an unexpected error. Your GAPs, chats and keys are stored
                locally and were not affected.
              </p>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-danger/8 p-3 text-xs text-danger">
                {error.message || String(error)}
              </pre>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" onClick={this.reset}>
                  Try again
                </Button>
                {fatal && (
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Reload Forge
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }
}
