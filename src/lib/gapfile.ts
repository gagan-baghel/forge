/**
 * GAP file (.gap) import/export. A GAP serializes to a single JSON document so
 * it can be shared, version-controlled, or published. Export strips runtime-only
 * fields; import re-homes ids.
 */

import type { Agent, Gap } from "@/types/domain";
import { asAgentSeeds, asRecord, asString } from "@/lib/validate";
import { saveTextFile } from "./saveFile";

const MAGIC = "forge.gap/v1";

export interface GapFile {
  magic: string;
  exportedAt: number;
  gap: Gap;
}

export function exportGap(gap: Gap): string {
  const file: GapFile = { magic: MAGIC, exportedAt: Date.now(), gap: stripSecrets(gap) };
  return JSON.stringify(file, null, 2);
}

/**
 * An agent with everything device- or person-specific removed: bot tokens and
 * webhook URLs (a shared bot token is a shared remote control of this Mac),
 * paired owners, and connector tokens (kept in `scopes[0]`). The channel and
 * connector entries stay so the recipient sees what to set up.
 */
export function stripAgentSecrets(agent: Agent): Agent {
  return {
    ...agent,
    channels: agent.channels.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      status: "inactive" as const,
      remoteControl: false,
      ...(c.config?.trigger ? { config: { trigger: c.config.trigger } } : {}),
    })),
    connectors: agent.connectors.map((c) => ({ ...c, scopes: undefined, status: "disconnected" as const })),
  };
}

/**
 * Environment values (pack env, MCP server env) routinely hold tokens — they
 * must never leave the machine inside a shared pack. Keys are kept, blanked,
 * so the recipient can see what to fill in.
 */
export function stripSecrets(gap: Gap): Gap {
  const blank = (env?: Record<string, string>) =>
    env ? Object.fromEntries(Object.keys(env).map((k) => [k, ""])) : undefined;
  return {
    ...gap,
    env: blank(gap.env),
    mcpServers: gap.mcpServers?.map((s) => ({ ...s, env: blank(s.env) })),
    agents: gap.agents.map(stripAgentSecrets),
  };
}

export function parseGapFile(text: string): Gap {
  let data: GapFile;
  try {
    data = JSON.parse(text) as GapFile;
  } catch {
    throw new Error("Not a valid .gap file.");
  }
  if (data?.magic !== MAGIC || !data.gap) {
    throw new Error("Not a valid .gap file.");
  }
  // The magic string only proves intent, not shape — a hand-edited or
  // truncated pack still has to satisfy the fields the app dereferences.
  const gap = asRecord(data.gap, "gap");
  asString(gap.name, "gap.name", { max: 200 });
  asAgentSeeds(gap.agents, "gap.agents");
  return data.gap;
}

/** Encode a GAP as a portable share code (base64 of the .gap JSON). */
export function encodeShareCode(gap: Gap): string {
  const json = exportGap(gap);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `forge:${btoa(bin)}`;
}

/** Decode a share code back into a GAP. */
export function decodeShareCode(code: string): Gap {
  const raw = code.trim().replace(/^forge:/, "");
  const bin = atob(raw);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return parseGapFile(new TextDecoder().decode(bytes));
}

/** Write a GAP to a file the user picks. Resolves false if they cancelled. */
export async function downloadGap(gap: Gap): Promise<boolean> {
  const { saved } = await saveTextFile(`${gap.slug}.gap`, exportGap(gap), {
    name: "GAP pack",
    extensions: ["gap"],
  });
  return saved;
}
