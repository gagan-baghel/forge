import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { hydrateSecrets } from "./stores/settings";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function mount() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary title="Forge hit an unexpected error" fatal>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

// Credentials live in the OS keychain, so they load asynchronously. Mount only
// once they're in the store — otherwise the first render sees no key and the
// UI briefly claims the app is unconfigured. A keychain failure still mounts.
void hydrateSecrets().catch(() => {}).finally(mount);
