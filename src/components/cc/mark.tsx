// The Vanishing Ink — CipherChat's mark.
//
// A drop of ink, seated on the page, its top fraying into three
// flecks that lift away. The writing is the drop; the ephemerality
// is the flecks; and the last fleck — the smallest, almost gone —
// is still warm (ember): the heat of the conversation leaving, not
// the paper burning. The silhouette is deliberately hand-fallen:
// the bulb's sides wobble a few percent off a compass circle, the
// tail leans a hair, and the detach edge is ragged, the way real
// ink parts when it lifts.
//
// Variants:
//   intact (default) — the seated drop with its flecks rising.
//                      Brand, landing, desk, centrepieces. With
//                      `breathe`, the flecks quietly rise and fade
//                      on a loop: the mark is always evaporating.
//   scattered         — the drop has lifted off: only its outline
//                      remains, rising away, while seven flecks
//                      flee outward and the ember flares once.
//                      Burn and destruction contexts only.
//   fleck             — one four-pointed fleck alone, filled with
//                      currentColor so it can carry any member ink
//                      (--ink-0..7) or a watermark tone. Typing
//                      dots, sender shards, quiet accents.
//   ghost             — the drop's outline stroked in currentColor,
//                      flecks filled. Watermarks at whisper
//                      opacity; never intercepts a touch. With
//                      `draw`, the outline inks itself onto the
//                      page and the flecks surface behind its tip
//                      (pathLength-normalised, so one dash unit
//                      is the whole drop).
//
// Geometry: hand-tuned beziers on a 96×96 grid. The drop is drawn
// upright (bulb centre ~(48,55), tail fraying at y≈25) and the
// whole assembly is rotated 21° and scaled about (48,48), so the
// flecks rise up-and-right — off the line of text, the direction
// writing leaves in.

import { cn } from "@/lib/utils";

/* The drop — a closed teardrop, joint radii wobbling (33.4 / 36.4 /
 * 62.8 against nominal bulbs), the top edge ragged where it parts. */
const DROP =
  "M 46.3 29.4 C 45.1 35.2, 39.9 38.6, 36.9 43.6 C 33.7 48.9, 33.2 56.1, 36.4 61.7 " +
  "C 39.5 67.2, 46.4 70.7, 52.3 68.8 C 58.2 66.9, 62.6 61.4, 62.7 55.5 " +
  "C 62.8 49.9, 59.5 45.0, 55.9 41.0 C 53.3 38.3, 51.5 35.0, 51.0 31.4 " +
  "L 49.7 29.5 L 48.1 31.1 Z";

/* A four-pointed fleck — quadratics pulled toward the centre make
 * the edges kiss in, a glint rather than a square. */
function fleckPath(cx: number, cy: number, r: number, lean = 0): string {
  const k = r * 0.42; // control pull
  return (
    `M ${cx} ${cy - r} Q ${cx + k} ${cy - k}, ${cx + r} ${cy + lean} ` +
    `Q ${cx + k} ${cy + k}, ${cx} ${cy + r} ` +
    `Q ${cx - k} ${cy + k}, ${cx - r} ${cy - lean} ` +
    `Q ${cx - k} ${cy - k}, ${cx} ${cy - r} Z`
  );
}

/* The three rising flecks — the ink leaving, scattered on a zigzag
 * as flecks are when they catch the air: up, up-right, up. Sizes
 * fall as they climb; the last is the ember (see intact render). */
const FLECK_1 = fleckPath(46.0, 21.5, 6.2);
const FLECK_2 = fleckPath(56.0, 11.5, 4.7);
const FLECK_3 = fleckPath(49.0, 3.2, 3.9);

/* The lone fleck the `fleck` variant carries — big enough to hold
 * a member ink at 9px, tilted the way the drop leans. */
const LONE_FLECK = fleckPath(48, 48, 27, 2.5);

/* Scatter positions for the `scattered` variant: where the flecks
 * flee to once the drop has left (drawn in the upright frame). */
const SCATTER: { d: string; ember?: boolean; fx: string; fy: string; delay: string }[] = [
  { d: fleckPath(31.0, 33.0, 2.5), fx: "-4.2px", fy: "-3.4px", delay: "300ms" },
  { d: fleckPath(64.5, 33.5, 2.1), fx: "4.6px", fy: "-2.8px", delay: "420ms", ember: true },
  { d: fleckPath(26.5, 51.0, 1.7), fx: "-3.4px", fy: "1.8px", delay: "500ms" },
  { d: fleckPath(68.0, 55.5, 2.3), fx: "3.8px", fy: "3.0px", delay: "360ms" },
  { d: fleckPath(37.0, 15.0, 1.8), fx: "-2.6px", fy: "-4.4px", delay: "580ms" },
  { d: fleckPath(58.5, 9.0, 2.0), fx: "2.4px", fy: "-4.6px", delay: "640ms", ember: true },
  { d: fleckPath(46.5, 78.5, 1.5), fx: "0.6px", fy: "4.2px", delay: "460ms" },
];

/* The seated assembly: rotate + a breath of scale + a nudge, all
 * baked into one attribute transform (px origins, viewBox
 * units — see the CSS notes in globals.css). Hand-checked: the
 * flecks land at (51.6,27.5) (67.0,26.1) (63.0,14.5) final —
 * each with 2.5–3 units of clear air between edges. */
const SEAT = "translate(44 61) rotate(21) scale(1.12) translate(-48 -48)";

export function InkMark({
  size = 64,
  breathe = false,
  variant = "intact",
  ink = "var(--forest)",
  draw = false,
  className,
  style,
}: {
  size?: number;
  breathe?: boolean;
  variant?: "intact" | "scattered" | "fleck" | "ghost";
  /** Drop body colour (drop + ink flecks). The fleck and ghost
   *  variants ignore it and take currentColor, so member inks can
   *  drive them from outside. */
  ink?: string;
  /** Ghost only: draw the outline on mount (ghost-draw) instead
   *  of appearing whole. Watermark entrances. */
  draw?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  // The fleck: one rising shard of ink, in whatever colour the
  // surrounding text already carries.
  if (variant === "fleck") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
        className={cn(breathe && "mark-breathe", className)}
        style={style}
      >
        <path d={LONE_FLECK} fill="currentColor" />
      </svg>
    );
  }

  const ghost = variant === "ghost";
  const scattered = variant === "scattered";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
      className={cn(
        breathe && "mark-breathe",
        ghost && draw && "ink-ghost-draw",
        className,
      )}
      style={style}
    >
      <g transform={SEAT}>
        {ghost ? (
          /* the whisper: outline drop, filled flecks */
          <>
            <path
              d={DROP}
              stroke="currentColor"
              strokeWidth={4.5}
              fill="none"
              className="ghost-drop"
              pathLength={draw ? 1 : undefined}
            />
            <path d={FLECK_1} fill="currentColor" className="ghost-fleck ghost-fleck-1" />
            <path d={FLECK_2} fill="currentColor" className="ghost-fleck ghost-fleck-2" />
            <path d={FLECK_3} fill="currentColor" className="ghost-fleck ghost-fleck-3" />
          </>
        ) : scattered ? (
          /* the drop has left — its outline rises after it */
          <>
            <path
              d={DROP}
              stroke={ink}
              strokeWidth={4.5}
              fill="none"
              className="ink-lift-off"
            />
            <path
              d={FLECK_1}
              fill={ink}
              className="ink-lift-off"
              style={{ animationDelay: "140ms" } as React.CSSProperties}
            />
            <path
              d={FLECK_2}
              fill={ink}
              className="ink-lift-off"
              style={{ animationDelay: "260ms" } as React.CSSProperties}
            />
            {/* the ember flares once as the ink departs, then dies */}
            <path
              d={FLECK_3}
              fill="var(--ember)"
              className="ember-flare"
            />
            {/* fleeing flecks — drift set per fleck via --fx/--fy */}
            {SCATTER.map((f, i) => (
              <path
                key={i}
                d={f.d}
                fill={f.ember ? "var(--terracotta)" : ink}
                className="fleck-flee"
                style={
                  {
                    "--fx": f.fx,
                    "--fy": f.fy,
                    animationDelay: f.delay,
                  } as React.CSSProperties
                }
              />
            ))}
          </>
        ) : (
          /* intact — the seated drop, its flecks rising. The flecks
             carry numbered classes so globals.css can stagger the
             evaporating loop (and stack the hero's landing splash)
             without inline delays — one inline animation-delay would
             bind every animation in a multi-animation shorthand. */
          <>
            <path d={DROP} fill={ink} />
            <path d={FLECK_1} fill={ink} className="ink-fleck ink-fleck-1" />
            <path d={FLECK_2} fill={ink} className="ink-fleck ink-fleck-2" />
            {/* the last trace is still warm as it goes */}
            <path
              d={FLECK_3}
              fill="var(--ember)"
              className="ink-fleck ink-fleck-3 ink-fleck-ember"
            />
          </>
        )}
      </g>
    </svg>
  );
}

/* Backwards-compatible alias: the mark's name changed with its
 * design; call sites that still say SealMark keep compiling. */
export const SealMark = InkMark;
