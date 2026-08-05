import { useGaps } from "@/stores/gaps";
import { useConversations } from "@/stores/conversations";
import { useRuns } from "@/stores/runs";
import { useSettings } from "@/stores/settings";
import { useMemory } from "@/stores/memory";
import { useRoutines } from "@/stores/routines";
import { useBrains } from "@/stores/brains";

/** Reset all persisted Zustand stores to a clean slate between tests. */
export function resetStores() {
  useGaps.setState({ gaps: [], seeded: true });
  useConversations.setState({ conversations: [] });
  useRuns.setState({ runs: [] });
  useMemory.setState({ notes: [] });
  useRoutines.setState({ routines: [] });
  useBrains.setState({ brains: [] });
  useSettings.setState({
    apiKey: "",
    ccToken: "",
    defaultModel: "claude-opus-4-8",
    runtime: "api",
    theme: "dusk",
    userName: "",
    onboarded: false,
  });
}
