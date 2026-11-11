import { lazy, Suspense, useEffect, type ReactElement, type ReactNode } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui";
import { useSettings } from "./stores/settings";
import { startScheduler } from "./lib/scheduler";
import { startUpdateChecks } from "./stores/update";
import { initChannelListener, resumeChannels, syncKeepAwake } from "./lib/channelRuntime";

import { HomeView } from "./views/Home";
import { GapsView } from "./views/Gaps";
import { AgentsView } from "./views/Agents";
import { AgentDetailView } from "./views/AgentDetail";
import { SettingsView } from "./views/Settings";
import { OnboardingView } from "./views/Onboarding";

const MarketplaceView = lazy(() => import("./views/Marketplace").then((m) => ({ default: m.MarketplaceView })));
const ArchitectView = lazy(() => import("./views/Architect").then((m) => ({ default: m.ArchitectView })));
const KnowledgeView = lazy(() => import("./views/Knowledge").then((m) => ({ default: m.KnowledgeView })));
const RemoteView = lazy(() => import("./views/Remote").then((m) => ({ default: m.RemoteView })));
const SchedulesView = lazy(() => import("./views/Schedules").then((m) => ({ default: m.SchedulesView })));
const TerminalView = lazy(() => import("./views/Terminal").then((m) => ({ default: m.TerminalView })));
const RunsView = lazy(() => import("./views/Runs").then((m) => ({ default: m.RunsView })));
const ObservabilityView = lazy(() => import("./views/Observability").then((m) => ({ default: m.ObservabilityView })));
const IntegrationsView = lazy(() => import("./views/Integrations").then((m) => ({ default: m.IntegrationsView })));
const WorkshopView = lazy(() => import("./views/Workshop").then((m) => ({ default: m.WorkshopView })));
const GapEditorView = lazy(() => import("./views/workshop/GapEditor").then((m) => ({ default: m.GapEditorView })));
const MemoryView = lazy(() => import("./views/Memory").then((m) => ({ default: m.MemoryView })));

function Loading() {
  return (
    <div className="grid h-full place-items-center text-ink-3">
      <Spinner size={22} />
    </div>
  );
}

function PackRedirect() {
  const { id } = useParams();
  return <Navigate to={`/gaps/${id}`} replace />;
}

function lazyRoute(el: ReactElement) {
  return <Suspense fallback={<Loading />}>{el}</Suspense>;
}

/**
 * Per-view crash guard. Keyed on pathname so the boundary remounts on
 * navigation — a crashed screen clears itself once the user moves away,
 * and the Shell (nav, sidebar) survives either way.
 */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

export function App() {
  const theme = useSettings((s) => s.theme);
  const onboarded = useSettings((s) => s.onboarded);

  // "system" follows the OS appearance, live.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () =>
      document.documentElement.setAttribute("data-theme", theme === "system" ? (media?.matches ? "paper" : "dusk") : theme);
    apply();
    if (theme !== "system" || !media?.addEventListener) return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  // Background services: routine scheduler + live channel message handler.
  useEffect(() => {
    if (!onboarded) return;
    const stop = startScheduler();
    void initChannelListener().then(resumeChannels);
    return stop;
  }, [onboarded]);

  // Looks for a newer signed release; the sidebar offers it when there is one.
  useEffect(() => startUpdateChecks(), []);

  const keepAwake = useSettings((s) => s.keepAwake);
  useEffect(() => syncKeepAwake(), [keepAwake]);

  if (!onboarded) {
    return <OnboardingView />;
  }

  return (
    <HashRouter>
      <Shell>
        <RouteBoundary>
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/gaps" element={<GapsView />} />
            <Route path="/gaps/:id" element={lazyRoute(<GapEditorView />)} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/agents/:id" element={<AgentDetailView />} />
            {/* Brains were folded into agents (lib/foldBrains). */}
            <Route path="/brains/*" element={<Navigate to="/agents" replace />} />
            <Route path="/memory" element={lazyRoute(<MemoryView />)} />
            <Route path="/workshop" element={lazyRoute(<WorkshopView />)} />
            {/* The pack editor used to live here; one page per pack now. */}
            <Route path="/workshop/:id" element={<PackRedirect />} />
            <Route path="/remote" element={lazyRoute(<RemoteView />)} />
            <Route path="/channels" element={<Navigate to="/remote" replace />} />
            <Route path="/architect" element={lazyRoute(<ArchitectView />)} />
            <Route path="/marketplace" element={lazyRoute(<MarketplaceView />)} />
            <Route path="/knowledge" element={lazyRoute(<KnowledgeView />)} />
            <Route path="/schedules" element={lazyRoute(<SchedulesView />)} />
            <Route path="/terminal" element={lazyRoute(<TerminalView />)} />
            <Route path="/runs" element={lazyRoute(<RunsView />)} />
            <Route path="/observability" element={lazyRoute(<ObservabilityView />)} />
            <Route path="/integrations" element={lazyRoute(<IntegrationsView />)} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RouteBoundary>
      </Shell>
    </HashRouter>
  );
}
