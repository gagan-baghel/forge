/** What an agent looks like, from its name: shared by BotFace and BotBuddy. */

/** Soft pastels that sit well on both themes; [head, outline]. */
const PALETTE: [string, string][] = [
  ["#F6C59F", "#D98E5F"], // peach
  ["#F4DC97", "#CFA84E"], // butter
  ["#C3DDAB", "#86AD6A"], // sage
  ["#B6D3EA", "#6F9CC0"], // sky
  ["#D7C2E6", "#A383BF"], // lilac
  ["#F4B8B0", "#D27B70"], // rose
  ["#B5E2D1", "#6DB49A"], // mint
  ["#EBD6BA", "#BD9A6E"], // sand
];

export const INK = "#2B211C";
export const BLUSH = "#F08A8A";

export function botHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** An agent's colours, from its name: [head and body, outline]. */
export function botColors(name: string): [string, string] {
  return PALETTE[botHash(name) % PALETTE.length];
}
