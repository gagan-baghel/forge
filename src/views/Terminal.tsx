import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { EmptyState } from "@/components/ui";
import { isDesktop } from "@/lib/platform";
import "@xterm/xterm/css/xterm.css";

/** Commands other views may ask the terminal to run via `?run=` (allowlist —
 *  the query string is user-visible, so never execute arbitrary text). */
const AUTORUN: Record<string, string> = {
  claude: "claude\r",
};

/**
 * A real terminal. On desktop it spawns a login shell PTY via Tauri and pipes
 * bytes both ways. On web there's no PTY, so we show a friendly placeholder.
 */
export function TerminalView() {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = isDesktop();
  const [searchParams] = useSearchParams();
  const autorun = AUTORUN[searchParams.get("run") ?? ""];

  useEffect(() => {
    if (!desktop || !ref.current) return;
    let dispose = () => {};

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      const term = new Terminal({
        fontFamily: "var(--f-mono)",
        fontSize: 13,
        theme: { background: "#0f1017", foreground: "#e9ecf5", cursor: "#6D5BFF" },
        cursorBlink: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current!);
      fit.fit();

      await invoke("pty_spawn", { cols: term.cols, rows: term.rows });

      // Deep-link: type the requested command once the shell settles
      // (e.g. /terminal?run=claude for first-time Claude Code sign-in).
      if (autorun) {
        setTimeout(() => void invoke("pty_write", { data: autorun }), 600);
      }

      const unlisten = await listen<string>("pty://data", (e) => term.write(e.payload));
      const onData = term.onData((d) => invoke("pty_write", { data: d }));
      const onResize = () => {
        fit.fit();
        void invoke("pty_resize", { cols: term.cols, rows: term.rows });
      };
      window.addEventListener("resize", onResize);

      dispose = () => {
        unlisten();
        onData.dispose();
        window.removeEventListener("resize", onResize);
        void invoke("pty_kill").catch(() => {});
        term.dispose();
      };
    })();

    return () => dispose();
  }, [desktop, autorun]);

  return (
    <div className="flex h-screen flex-col">
      <PageHeader title="Terminal" subtitle="A real shell, scoped to your machine" />
      {desktop ? (
        <div ref={ref} className="flex-1 overflow-hidden bg-[#0f1017] p-2" />
      ) : (
        <EmptyState
          icon="terminal"
          title="Terminal needs the desktop app"
          body="The terminal spawns a real shell process on your machine, which isn't available in the web build. Run `pnpm desktop` to launch Forge natively."
        />
      )}
    </div>
  );
}
