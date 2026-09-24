import { Link } from "react-router-dom";
import type { Agent } from "@/types/domain";
import { ChannelCard } from "@/components/remote/ChannelCard";

export function ChannelsTab({ agent }: { agent: Agent }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-[13px] text-ink-3">
        Message {agent.name} from your phone. Pair your phone so only you can reach it, and turn on remote control to let it
        work on this Mac with your approval. Everything live is also on the{" "}
        <Link to="/remote" className="text-brand-2 hover:underline">
          Remote
        </Link>{" "}
        page.
      </p>
      <ChannelCard agent={agent} kind="telegram" />
      <ChannelCard agent={agent} kind="discord" />
    </div>
  );
}
