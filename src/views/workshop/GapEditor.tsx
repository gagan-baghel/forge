import { useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Button, EmptyState } from "@/components/ui";
import { PageBody, PageHeader } from "@/components/Shell";
import { usePublished } from "@/stores/published";
import { Icon } from "@/components/Icon";
import { useGaps } from "@/stores/gaps";
import type { Gap } from "@/types/domain";
import { AgentsSection } from "./sections/Agents";
import { IdentitySection } from "./sections/Identity";
import { McpSection } from "./sections/Mcp";
import { EnvironmentSection } from "./sections/Environment";
import { AdvancedSection } from "./sections/Advanced";
import { useExportGap } from "./useExportGap";

type Section = "identity" | "agents" | "mcp" | "environment" | "advanced";
/** Adding a section is one entry here plus its component in ./sections. */
const SECTIONS: {
  id: Section;
  label: string;
  icon: string;
  Body: ComponentType<{ gap: Gap }>;
  count?: (g: Gap) => number;
}[] = [
  { id: "agents", label: "Agents", icon: "agents", Body: AgentsSection, count: (g) => g.agents.length },
  { id: "identity", label: "Details", icon: "edit", Body: IdentitySection },
  { id: "mcp", label: "MCP servers", icon: "plug", Body: McpSection, count: (g) => g.mcpServers?.length ?? 0 },
  { id: "environment", label: "Environment", icon: "terminal", Body: EnvironmentSection },
  { id: "advanced", label: "Advanced", icon: "settings", Body: AdvancedSection },
];

/**
 * The pack page — the one place a pack is viewed and edited. Everything a
 * `.gap` file carries lives here: the agents inside, details, MCP servers,
 * environment, sharing, and a raw JSON escape hatch.
 */
export function GapEditorView() {
  const exportGap = useExportGap();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const gap = useGaps((s) => s.findGap(id));
  const [section, setSection] = useState<Section>("agents");
  const publish = usePublished((s) => s.publish);
  const unpublish = usePublished((s) => s.unpublish);
  const published = usePublished((s) => (gap ? s.isPublished(gap.slug) : false));

  if (!gap) {
    return (
      <PageBody>
        <EmptyState
          icon="grid"
          title="Pack not found"
          action={<Button onClick={() => navigate("/gaps")}>Back to packs</Button>}
        />
      </PageBody>
    );
  }

  const Body = SECTIONS.find((s) => s.id === section)!.Body;

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        back={{ to: "/gaps", label: "Packs" }}
        title={gap.name}
        subtitle={`v${gap.version} · ${gap.agents.length} agent${gap.agents.length === 1 ? "" : "s"}${gap.description ? ` · ${gap.description}` : ""}`}
        actions={
          <>
            <Button icon="download" onClick={() => exportGap(gap)}>
              Export .gap
            </Button>
            {published ? (
              <Button icon="check" onClick={() => unpublish(gap.slug)} title="Remove from your Marketplace listing">
                Published
              </Button>
            ) : (
              <Button icon="store" onClick={() => publish(gap)}>
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-[184px] shrink-0 space-y-px border-r border-border p-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={clsx(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                section === s.id ? "bg-surface-2/70 font-medium text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              <Icon name={s.icon} size={15} className={section === s.id ? "text-brand" : "text-ink-3"} />
              {s.label}
              {s.count && (s.id === "agents" || s.count(gap) > 0) && (
                <span className="ml-auto font-mono text-[10px] text-ink-3">{s.count(gap)}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-6 px-8 py-6">
            <Body gap={gap} />
          </div>
        </div>
      </div>
    </div>
  );
}
