import { useEffect, useState } from "react";
import clsx from "clsx";
import { BotHead } from "./BotFace";
import { BLUSH, INK, botColors } from "@/lib/botLook";

/**
 * An agent as a little full-body robot that acts out what it's doing:
 *  - "play"  — idle, so it plays like a kid: waves, hops, toddles about,
 *              hangs from a bar kicking its legs, or just stands and breathes;
 *  - "think" — working on a reply: hand on chin, a thought bubble;
 *  - "talk"  — the reply is streaming in: a happy bob;
 *  - "sleep" — the agent is paused: slumped, eyes shut, z's, a little drool.
 *
 * Every part is always drawn and each pose only moves or fades parts
 * (globals.css, `.bb-*`), so changes ease instead of snapping. Each play
 * action starts and ends in the same standing pose and lasts exactly its
 * animation, and a short rest sits between actions, so one hands over to the
 * next without a jump. Same head as BotFace. Holds still for reduced motion.
 */
export type BuddyMood = "play" | "think" | "talk" | "sleep";
type Action = "wave" | "jump" | "walk" | "hang" | "rest";

/** Each play action and how long it runs: matched to its animation in globals.css. */
const ACTIONS: [Action, number][] = [
  ["wave", 2400],
  ["jump", 2800],
  ["walk", 4000],
  ["hang", 4200],
  ["rest", 2200],
];
const REST = ACTIONS.length - 1;

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The play action right now: action, rest, another action, rest… */
function usePlay(active: boolean, seed: number): Action {
  const [i, setI] = useState(seed % REST);
  useEffect(() => {
    if (!active || reducedMotion()) return;
    const t = setTimeout(() => {
      setI((cur) => {
        if (cur !== REST) return REST;
        return Math.floor(Math.random() * REST);
      });
    }, ACTIONS[i][1]);
    return () => clearTimeout(t);
  }, [active, i]);
  return active && !reducedMotion() ? ACTIONS[i][0] : "rest";
}

export function BotBuddy({ name, mood, size = 96 }: { name: string; mood: BuddyMood; size?: number }) {
  const [fill, edge] = botColors(name);
  const seed = [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
  const action = usePlay(mood === "play", seed);
  const pose = mood === "play" ? action : mood;

  const limb = (d: string, hand?: [number, number]) => (
    <>
      <path d={d} fill="none" stroke={edge} strokeWidth={4.4} strokeLinecap="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={2.4} strokeLinecap="round" />
      {hand && <circle cx={hand[0]} cy={hand[1]} r={2.3} fill={fill} stroke={edge} strokeWidth={1.1} />}
    </>
  );

  return (
    <svg
      width={size}
      height={(size * 74) / 64}
      viewBox="0 0 64 74"
      aria-hidden
      className={clsx("bb shrink-0 select-none overflow-visible", `bb-${pose}`)}
    >
      <ellipse className="bb-shadow" cx={32} cy={70} rx={12} ry={2} fill="#000" opacity={0.22} />
      <path className="bb-bar" d="M6 7h52" stroke="#B98A5E" strokeWidth={2.6} strokeLinecap="round" />

      <g className="bb-all">
        <g className="bb-breathe">
          {/* Arms behind the body: stretched up to the bar while hanging, else down */}
          <g className="bb-hang-arm bb-hang-arm-l">{limb("M24 46V7", [24, 7])}</g>
          <g className="bb-hang-arm bb-hang-arm-r">{limb("M40 46V7", [40, 7])}</g>
          <g className="bb-arm-l">{limb("M24 46Q20 50 19 54", [19, 54])}</g>
          <g className="bb-arm-r">{limb("M40 46Q44 50 45 54", [45, 54])}</g>

          <g className="bb-leg-l">
            {limb("M28 58V65")}
            <ellipse cx={27.4} cy={66.6} rx={3.3} ry={2} fill={fill} stroke={edge} strokeWidth={1.1} />
          </g>
          <g className="bb-leg-r">
            {limb("M36 58V65")}
            <ellipse cx={36.6} cy={66.6} rx={3.3} ry={2} fill={fill} stroke={edge} strokeWidth={1.1} />
          </g>

          <rect x={22.5} y={42} width={19} height={18} rx={7.5} fill={fill} stroke={edge} strokeWidth={1.3} />
          <path
            d="M32 54.2c-2.6-1.7-3.6-3-3.6-4.2 0-1.1.9-1.9 1.9-1.9.7 0 1.3.4 1.7 1 .4-.6 1-1 1.7-1 1 0 1.9.8 1.9 1.9 0 1.2-1 2.5-3.6 4.2Z"
            fill={BLUSH}
            opacity={0.85}
          />

          <g className="bb-head">
            <g transform="translate(16 14)">
              <BotHead name={name} blink={pose !== "sleep"} sleeping={pose === "sleep"} />
            </g>
          </g>

          {/* Hand on chin, in front of the face */}
          <g className="bb-chin">{limb("M40 46Q45 46 37.6 41.4", [37.6, 41.4])}</g>

          <path
            className="bb-drool"
            d="M33.6 38.4q1 2.4 0 3.6q-1-1.2 0-3.6Z"
            fill="#9FD3F0"
            stroke="#6FB2DA"
            strokeWidth={0.4}
          />
        </g>
      </g>

      <g className="bb-bubble" fill="#F4EFEA" stroke={edge} strokeWidth={0.8}>
        <circle cx={45} cy={29} r={1.1} />
        <circle cx={48.2} cy={24.6} r={1.7} />
        <ellipse cx={55} cy={16} rx={8} ry={5.6} />
        {[51.6, 55, 58.4].map((x, i) => (
          <circle
            key={x}
            className="bb-dot"
            style={{ animationDelay: `${i * 0.3}s` }}
            cx={x}
            cy={16}
            r={1.1}
            fill={INK}
            stroke="none"
          />
        ))}
      </g>

      <g className="bb-zs">
        {[
          [46, 22, 5],
          [51, 15, 6.5],
          [56.5, 7, 8],
        ].map(([x, y, s], i) => (
          <text
            key={i}
            className="bb-z"
            style={{ animationDelay: `${i * 0.8}s` }}
            x={x}
            y={y}
            fontSize={s}
            fontWeight={700}
            fill={edge}
            fontFamily="ui-rounded, system-ui, sans-serif"
          >
            z
          </text>
        ))}
      </g>
    </svg>
  );
}
