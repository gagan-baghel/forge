import { describe, it, expect, beforeEach } from "vitest";
import { marketplaceCatalog, starterGaps } from "@/lib/seed";
import { normalizeGap } from "@/lib/gapSchema";
import { teamFor } from "@/lib/pack";
import { useGaps } from "@/stores/gaps";
import { resetStores } from "@/test/reset";
import type { Gap } from "@/types/domain";

const catalog = marketplaceCatalog();
const packs = catalog.map((l) => l.gap as unknown as Gap);
const bySlug = (slug: string) => packs.find((p) => p.slug === slug)!;

beforeEach(() => resetStores());

describe("Marketplace catalog", () => {
  it("every pack is a valid .gap", () => {
    for (const p of packs) expect(() => normalizeGap(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });

  it("has the packs people asked for: stocks, writing, coding, data, product", () => {
    for (const slug of ["market-research-desk", "content-studio", "dev-crew", "data-lab", "product-studio"])
      expect(bySlug(slug)).toBeDefined();
  });

  it('never says "platform"', () => {
    expect(JSON.stringify(catalog).toLowerCase()).not.toContain("platform");
  });

  it("agent names are unique everywhere, so faces and @Name never collide", () => {
    const names = [...starterGaps(), ...packs].flatMap((p) => p.agents.map((a) => a.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });

  it("every agent has a role line, instructions and a known model", () => {
    for (const p of packs)
      for (const a of p.agents) {
        expect(a.role.length, `${p.name}/${a.name} role`).toBeGreaterThan(10);
        expect(a.systemPrompt.length, `${p.name}/${a.name} prompt`).toBeGreaterThan(150);
        expect(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]).toContain(a.model);
      }
  });

  it("team packs open with a lead who brings in teammates", () => {
    for (const p of packs.filter((p) => p.agents.length > 1)) expect(p.agents[0].role.toLowerCase()).toMatch(/lead/);
  });

  it("writers and builders can give long answers; chatty roles stay lean", () => {
    expect(bySlug("content-studio").agents.find((a) => a.name === "Ink")!.maxTokens).toBeGreaterThanOrEqual(8192);
    expect(bySlug("dev-crew").agents.find((a) => a.name === "Bolt")!.maxTokens).toBeGreaterThanOrEqual(8192);
  });

  it("only agents that build or test code get the Computer skill", () => {
    const withComputer = packs.flatMap((p) =>
      p.agents.filter((a) => a.skills.some((s) => s.kind === "computer")).map((a) => a.name),
    );
    expect(withComputer.sort()).toEqual(["Bolt", "Probe"]);
  });

  it("the stock pack researches, never advises", () => {
    const desk = bySlug("market-research-desk");
    expect(desk.agents[0].systemPrompt).toMatch(/not personalised investment advice/);
    expect(desk.agents[0].systemPrompt).toMatch(/never tell the user to buy, sell or hold/);
    expect(desk.knowledge!.map((d) => d.content).join(" ")).toMatch(/not investment advice/);
    expect(desk.agents.find((a) => a.name === "Quant")!.skills.map((s) => s.kind)).toContain("code");
  });

  it("installing a pack brings its shared knowledge and a working team", () => {
    const installed = useGaps.getState().installListing(catalog.find((l) => l.gap.slug === "market-research-desk")!);
    expect(installed.knowledge?.map((d) => d.title)).toEqual([
      "Research standards",
      "Brief format",
      "Valuation cheat sheet",
    ]);
    expect(installed.agents.every((a) => a.gapId === installed.id)).toBe(true);
    const { extraTools } = teamFor(installed, installed.agents[0]);
    expect((extraTools![0].def.input_schema as any).properties.teammate.enum).toEqual(["Wire", "Quant", "Bear"]);
  });

  it("shows no made-up popularity for new packs", () => {
    for (const slug of ["market-research-desk", "content-studio", "dev-crew", "data-lab", "product-studio"]) {
      const l = catalog.find((x) => x.gap.slug === slug)!;
      expect(l.installs).toBe(0);
      expect(l.rating).toBe(0);
    }
  });
});
