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
