import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DialogProvider } from "./components/Confirm";
import "./styles/globals.css";

function mount() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary title="Forge hit an unexpected error" fatal>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

mount();

// End-to-end test builds only (VITE_FORGE_E2E=1 at build time): expose the
// stores and channel runtime so a test can set the app up without the GUI.
if ((import.meta as any).env?.VITE_FORGE_E2E) {
  void Promise.all([
    import("./stores/gaps"),
    import("./stores/settings"),
    import("./stores/channelRuntime"),
    import("./stores/conversations"),
    import("./stores/runs"),
    import("./lib/channelRuntime"),
  ]).then(([gaps, settings, rt, convs, runs, channels]) => {
    (window as any).__forge = { ...gaps, ...settings, ...rt, ...convs, ...runs, ...channels };
  });
}
