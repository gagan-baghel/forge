import { lazy, Suspense, useEffect, type ReactElement, type ReactNode } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui";
import { useSettings } from "./stores/settings";
import { startScheduler } from "./lib/scheduler";
import { initChannelListener } from "./lib/channelRuntime";

import { HomeView } from "./views/Home";
import { GapsView } from "./views/Gaps";
import { GapDetailView } from "./views/GapDetail";
import { AgentsView } from "./views/Agents";
import { AgentDetailView } from "./views/AgentDetail";
import { SettingsView } from "./views/Settings";
import { OnboardingView } from "./views/Onboarding";

const MarketplaceView = lazy(() => import("./views/Marketplace").then((m) => ({ default: m.MarketplaceView })));
const ArchitectView = lazy(() => import("./views/Architect").then((m) => ({ default: m.ArchitectView })));
const KnowledgeView = lazy(() => import("./views/Knowledge").then((m) => ({ default: m.KnowledgeView })));
const ChannelsView = lazy(() => import("./views/Channels").then((m) => ({ default: m.ChannelsView })));
const SchedulesView = lazy(() => import("./views/Schedules").then((m) => ({ default: m.SchedulesView })));
const TerminalView = lazy(() => import("./views/Terminal").then((m) => ({ default: m.TerminalView })));
const RunsView = lazy(() => import("./views/Runs").then((m) => ({ default: m.RunsView })));
const ObservabilityView = lazy(() => import("./views/Observability").then((m) => ({ default: m.ObservabilityView })));
const IntegrationsView = lazy(() => import("./views/Integrations").then((m) => ({ default: m.IntegrationsView })));
const TeamView = lazy(() => import("./views/Team").then((m) => ({ default: m.TeamView })));
const WorkshopView = lazy(() => import("./views/Workshop").then((m) => ({ default: m.WorkshopView })));
const GapEditorView = lazy(() => import("./views/workshop/GapEditor").then((m) => ({ default: m.GapEditorView })));
const BrainsView = lazy(() => import("./views/Brains").then((m) => ({ default: m.BrainsView })));
const BrainDetailView = lazy(() => import("./views/BrainDetail").then((m) => ({ default: m.BrainDetailView })));
const MemoryView = lazy(() => import("./views/Memory").then((m) => ({ default: m.MemoryView })));

function Loading() {
  return (
    <div className="grid h-full place-items-center text-ink-3">
      <Spinner size={22} />
    </div>
  );
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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Background services: routine scheduler + live channel message handler.
  useEffect(() => {
    if (!onboarded) return;
    const stop = startScheduler();
    void initChannelListener();
    return stop;
  }, [onboarded]);

  if (!onboarded) {
    return <OnboardingView />;
  }

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell>
        <RouteBoundary>
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/gaps" element={<GapsView />} />
            <Route path="/gaps/:id" element={<GapDetailView />} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/agents/:id" element={<AgentDetailView />} />
            <Route path="/brains" element={lazyRoute(<BrainsView />)} />
            <Route path="/brains/:id" element={lazyRoute(<BrainDetailView />)} />
            <Route path="/memory" element={lazyRoute(<MemoryView />)} />
            <Route path="/workshop" element={lazyRoute(<WorkshopView />)} />
            <Route path="/workshop/:id" element={lazyRoute(<GapEditorView />)} />
            <Route path="/channels" element={lazyRoute(<ChannelsView />)} />
            <Route path="/architect" element={lazyRoute(<ArchitectView />)} />
            <Route path="/marketplace" element={lazyRoute(<MarketplaceView />)} />
            <Route path="/knowledge" element={lazyRoute(<KnowledgeView />)} />
            <Route path="/schedules" element={lazyRoute(<SchedulesView />)} />
            <Route path="/terminal" element={lazyRoute(<TerminalView />)} />
            <Route path="/runs" element={lazyRoute(<RunsView />)} />
            <Route path="/observability" element={lazyRoute(<ObservabilityView />)} />
            <Route path="/integrations" element={lazyRoute(<IntegrationsView />)} />
            <Route path="/team" element={lazyRoute(<TeamView />)} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RouteBoundary>
      </Shell>
    </HashRouter>
  );
}
