import { Card, CardHeader } from "@/components/ui";
import { useGaps } from "@/stores/gaps";
import type { Gap } from "@/types/domain";
import { EnvRows } from "./EnvRows";

export function EnvironmentSection({ gap }: { gap: Gap }) {
  const updateGap = useGaps((s) => s.updateGap);
  return (
    <Card>
      <CardHeader
        title="Environment"
        hint="Variables injected into this pack's Claude Code runs and its MCP servers. Stored locally with the pack."
      />
      <EnvRows label="Variables" env={gap.env ?? {}} onChange={(env) => updateGap(gap.id, { env })} />
    </Card>
  );
}
