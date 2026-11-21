import clsx from "clsx";
import { BLUSH, INK, botColors, botHash as hash } from "@/lib/botLook";

/**
 * An agent's face: a small, friendly robot drawn from a hash of its name.
 * Same name, same face, everywhere — including the builder's preview before
 * the agent exists.
 *
 * Drawn to read as cute, not mechanical, at 20px as well as 60px: a solid
 * pastel head (light in both themes), big dark eyes set low with a shine,
 * rosy cheeks and a smile. Variety comes from colour, head shape, eyes, smile
 * and what sits on top. No teeth, visors or square jaws: at small sizes those
 * read as skulls.
 *
 * Packs keep their monogram tile (Avatar), so a team and a teammate never
 * look alike.
 */

export function BotFace({
  name,
  size = 32,
  blink = size >= 24,
  className,
}: {
  name: string;
  size?: number;
  /** Blink now and then. Off for tiny faces, and for reduced motion (globals.css). */
  blink?: boolean;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={clsx("shrink-0 select-none", className)}>
      <title>{name}</title>
      <BotHead name={name} blink={blink} />
    </svg>
  );
}

/** The head, drawn in a 32×32 box: BotFace frames it, BotBuddy puts it on a body. */
export function BotHead({ name, blink, sleeping }: { name: string; blink?: boolean; sleeping?: boolean }) {
  const h = hash(name);
  const pick = (n: number, shift: number) => (h >>> shift) % n;
  const [fill, edge] = botColors(name);
  const head = pick(3, 4);
  const eyes = pick(3, 7);
  const mouth = pick(3, 10);
  // Always something on top: without it a face reads as a baby, not a robot.
  const top = 1 + pick(3, 13);
  const ears = pick(2, 16) === 1;
  const stroke = { stroke: INK, strokeWidth: 1.6, strokeLinecap: "round" as const, fill: "none" };

  return (
    <g>
      {/* What sits on top */}
      {top === 1 && (
        <>
          <path d="M16 8V4.6" stroke={edge} strokeWidth={1.6} strokeLinecap="round" />
          <circle cx={16} cy={3.6} r={2.1} fill={fill} stroke={edge} strokeWidth={1.2} />
        </>
      )}
      {top === 2 && (
        // A little sprout
        <>
          <path d="M16 8.2V5.4" stroke="#7FA36B" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M16 5.6c-.4-2.2-2.4-3.2-4.2-2.6.3 2 2.2 3 4.2 2.6Z" fill="#9CC584" />
          <path d="M16 5.6c.4-2.2 2.4-3.2 4.2-2.6-.3 2-2.2 3-4.2 2.6Z" fill="#9CC584" />
        </>
      )}
      {top === 3 && (
        // Two small bobbles
        <>
          <path d="M11.5 9 10.4 5.6M20.5 9l1.1-3.4" stroke={edge} strokeWidth={1.4} strokeLinecap="round" />
          <circle cx={10.2} cy={5} r={1.5} fill={fill} stroke={edge} strokeWidth={1.1} />
          <circle cx={21.8} cy={5} r={1.5} fill={fill} stroke={edge} strokeWidth={1.1} />
        </>
      )}

      {/* Ears */}
      {ears && (
        <>
          <circle cx={4.2} cy={19} r={2.4} fill={fill} stroke={edge} strokeWidth={1.2} />
          <circle cx={27.8} cy={19} r={2.4} fill={fill} stroke={edge} strokeWidth={1.2} />
        </>
      )}

      {/* Head: always soft */}
      <rect
        {...(head === 0
          ? { x: 4.5, y: 7.5, width: 23, height: 22, rx: 11 }
          : head === 1
            ? { x: 4.5, y: 8, width: 23, height: 21, rx: 8.5 }
            : { x: 3.5, y: 9.5, width: 25, height: 19.5, rx: 9.75 })}
        fill={fill}
        stroke={edge}
        strokeWidth={1.3}
      />

      {/* Cheeks */}
      <ellipse cx={9.2} cy={22.6} rx={2} ry={1.3} fill={BLUSH} opacity={0.55} />
      <ellipse cx={22.8} cy={22.6} rx={2} ry={1.3} fill={BLUSH} opacity={0.55} />

      {/* Eyes: big, low and wide-set, in their own group so they can blink */}
      <g
        className={blink && !sleeping ? "bot-blink" : undefined}
        style={blink && !sleeping ? { animationDelay: `${(h % 5000) / 1000}s` } : undefined}
      >
        {sleeping && <path d="M9.4 18.2q2.2 2 4.4 0M18.2 18.2q2.2 2 4.4 0" {...stroke} />}
        {!sleeping && eyes === 0 && (
          <>
            <circle cx={11.6} cy={18.6} r={2.5} fill={INK} />
            <circle cx={20.4} cy={18.6} r={2.5} fill={INK} />
            <circle cx={12.5} cy={17.6} r={0.9} fill="#fff" />
            <circle cx={21.3} cy={17.6} r={0.9} fill="#fff" />
          </>
        )}
        {!sleeping && eyes === 1 && (
          <>
            <ellipse cx={11.6} cy={18.6} rx={2.1} ry={2.8} fill={INK} />
            <ellipse cx={20.4} cy={18.6} rx={2.1} ry={2.8} fill={INK} />
            <circle cx={12.3} cy={17.4} r={0.85} fill="#fff" />
            <circle cx={21.1} cy={17.4} r={0.85} fill="#fff" />
          </>
        )}
        {/* Content, eyes closed in a smile */}
        {!sleeping && eyes === 2 && <path d="M9.4 19.2q2.2-2.8 4.4 0M18.2 19.2q2.2-2.8 4.4 0" {...stroke} />}
      </g>

      {/* Smile (a small "o" while asleep) */}
      {sleeping && <ellipse cx={16} cy={23.8} rx={1.1} ry={0.9} fill={INK} />}
      {!sleeping && mouth === 0 && <path d="M14.2 23.4q1.8 1.8 3.6 0" {...stroke} strokeWidth={1.4} />}
      {!sleeping && mouth === 1 && <path d="M13.9 22.9h4.2q0 2.6-2.1 2.6t-2.1-2.6Z" fill={INK} />}
      {!sleeping && mouth === 2 && <path d="M13.6 23.2q1.2 1.3 2.4 0 1.2 1.3 2.4 0" {...stroke} strokeWidth={1.3} />}
    </g>
  );
}

/** A pack's team at a glance: overlapping faces, then "+n". */
export function BotStack({
  agents,
  size = 22,
  max = 3,
}: {
  agents: { id: string; name: string }[];
  size?: number;
  max?: number;
}) {
  const shown = agents.slice(0, max);
  const more = agents.length - shown.length;
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((a, i) => (
        <span key={a.id} className={clsx(i > 0 && "-ml-2")} style={{ zIndex: max - i }}>
          <BotFace name={a.name} size={size} blink={false} />
        </span>
      ))}
      {more > 0 && <span className="ml-1 font-mono text-[10px] text-ink-3">+{more}</span>}
    </span>
  );
}
