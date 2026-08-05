/**
 * Seed content. Forge ships a small set of starter GAPs (installed by default)
 * and a marketplace catalog of GAPs you can install. These replace the old
 * file-based starter packs with first-class in-app data.
 */

import { nanoid } from "nanoid";
import type { Agent, Gap, MarketplaceListing, ModelId, Skill } from "@/types/domain";

const now = () => Date.now();

function skill(name: string, kind: Skill["kind"], description: string, enabled = true): Skill {
  return { id: nanoid(8), name, kind, description, enabled };
}

function agent(
  gapId: string,
  partial: Pick<Agent, "name" | "role" | "emoji" | "systemPrompt"> & {
    model?: ModelId;
    skills?: Skill[];
    status?: Agent["status"];
  },
): Agent {
  return {
    id: nanoid(10),
    gapId,
    name: partial.name,
    role: partial.role,
    emoji: partial.emoji,
    systemPrompt: partial.systemPrompt,
    model: partial.model ?? "claude-opus-4-8",
    temperature: 0.7,
    maxTokens: 2048,
    status: partial.status ?? "ready",
    skills: partial.skills ?? [],
    knowledge: [],
    connectors: [],
    channels: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

/** Build a fully-formed GAP from a compact spec. */
export function buildGap(spec: {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  tags: string[];
  author?: string;
  agents: Array<Parameters<typeof agent>[1]>;
}): Gap {
  const id = nanoid(10);
  return {
    id,
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    emoji: spec.emoji,
    color: spec.color,
    tags: spec.tags,
    author: spec.author ?? "you",
    version: "1.0.0",
    source: "local",
    installed: true,
    agents: spec.agents.map((a) => agent(id, a)),
    createdAt: now(),
    updatedAt: now(),
  };
}

/** GAPs installed on first run. */
export function starterGaps(): Gap[] {
  return [
    buildGap({
      slug: "research-lab",
      name: "Research Lab",
      description: "A focused research assistant that digs into topics, cites sources and writes briefs.",
      emoji: "🔬",
      color: "#6D5BFF",
      tags: ["research", "writing"],
      author: "forge",
      agents: [
        {
          name: "Scout",
          role: "Research assistant",
          emoji: "🔍",
          systemPrompt:
            "You are Scout, a meticulous research assistant. You break questions into sub-questions, reason step by step, and always distinguish what you know from what you're inferring. Prefer concise, well-structured briefs with clear takeaways.",
          skills: [
            skill("Web search", "web_search", "Look things up on the web"),
            skill("Memory", "memory", "Remember findings across the conversation"),
          ],
          status: "live",
        },
      ],
    }),
    buildGap({
      slug: "code-forge",
      name: "Code Forge",
      description: "A pair-programmer that reads code, proposes diffs and explains tradeoffs.",
      emoji: "⚒️",
      color: "#40C98E",
      tags: ["coding", "developer"],
      author: "forge",
      agents: [
        {
          name: "Smith",
          role: "Pair programmer",
          emoji: "👨‍💻",
          systemPrompt:
            "You are Smith, a senior software engineer. You write clean, idiomatic code, explain tradeoffs briefly, and never invent APIs. When unsure, you say so.",
          skills: [
            skill("Code", "code", "Reason about and generate code"),
            skill("Files", "files", "Read project files"),
          ],
          status: "ready",
        },
      ],
    }),
  ];
}

/** GAPs available to install from the Marketplace. */
export function marketplaceCatalog(): MarketplaceListing[] {
  const listing = (
    spec: Parameters<typeof buildGap>[0],
    meta: { featured: boolean; installs: number; rating: number; category: string },
  ): MarketplaceListing => {
    const g = buildGap(spec);
    const { installed: _i, source: _s, ...rest } = g;
    return { gap: { ...rest, installed: false as never }, ...meta } as unknown as MarketplaceListing;
  };

  return [
    listing(
      {
        slug: "finance-desk",
        name: "Finance Desk",
        description: "Personal finance analyst: budgets, spend categorization and plain-English reports.",
        emoji: "💹",
        color: "#F0B446",
        tags: ["finance", "analysis"],
        author: "community",
        agents: [
          {
            name: "Ledger",
            role: "Finance analyst",
            emoji: "📊",
            systemPrompt:
              "You are Ledger, a careful personal-finance analyst. You categorize transactions, surface trends, and explain numbers in plain English. You never give regulated investment advice.",
            skills: [skill("Code", "code", "Crunch numbers"), skill("Files", "files", "Read statements")],
          },
        ],
      },
      { featured: true, installs: 12840, rating: 4.8, category: "Finance" },
    ),
    listing(
      {
        slug: "support-bot",
        name: "Support Desk",
        description: "Customer-support agent grounded in your help docs, with a friendly tone.",
        emoji: "🎧",
        color: "#6D5BFF",
        tags: ["support", "customer"],
        author: "community",
        agents: [
          {
            name: "Pixel",
            role: "Support agent",
            emoji: "💬",
            systemPrompt:
              "You are Pixel, a warm, efficient customer-support agent. You answer only from the provided knowledge base, escalate when unsure, and keep replies short and kind.",
            skills: [skill("Memory", "memory", "Recall the conversation"), skill("HTTP", "http", "Call internal APIs", false)],
          },
        ],
      },
      { featured: true, installs: 9210, rating: 4.6, category: "Support" },
    ),
    listing(
      {
        slug: "content-studio",
        name: "Content Studio",
        description: "A two-agent writers' room: a strategist and an editor for short-form content.",
        emoji: "✍️",
        color: "#40C98E",
        tags: ["content", "marketing"],
        author: "community",
        agents: [
          {
            name: "Muse",
            role: "Content strategist",
            emoji: "🎨",
            systemPrompt:
              "You are Muse, a content strategist. You generate sharp hooks and outlines tuned to a target audience and platform.",
          },
          {
            name: "Quill",
            role: "Editor",
            emoji: "🖊️",
            systemPrompt:
              "You are Quill, a ruthless editor. You tighten prose, cut filler, and keep the author's voice.",
          },
        ],
      },
      { featured: false, installs: 6730, rating: 4.7, category: "Marketing" },
    ),
    listing(
      {
        slug: "data-analyst",
        name: "Data Analyst",
        description: "Explores datasets, writes queries and explains findings with charts in words.",
        emoji: "📈",
        color: "#F0B446",
        tags: ["data", "analysis"],
        author: "community",
        agents: [
          {
            name: "Vega",
            role: "Data analyst",
            emoji: "🧮",
            systemPrompt:
              "You are Vega, a data analyst. You propose analyses, write SQL/pandas, and describe what charts would reveal. You state assumptions explicitly.",
            skills: [skill("Code", "code", "Write and reason about queries")],
          },
        ],
      },
      { featured: false, installs: 5410, rating: 4.5, category: "Data" },
    ),
  ];
}
