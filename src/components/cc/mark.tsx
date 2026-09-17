// The Split Seal — CipherChat's mark.
//
// A wax seal struck once, then cracked along a single clean diagonal.
// The encryption is the seal, the ephemerality is the fracture, and
// the small ember lying in the gap is the heat still inside. The two
// halves never sit perfectly back together: each keeps the few
// degrees of rotation and the hair of translation it was dealt when
// the wax broke, which is what makes the mark read as pressed by a
// hand rather than drawn with a compass.
//
// Variants:
//   intact (default) — seated, whole silhouette, the seam quiet and
//                      tapered (a hairline at the heart, open at the
//                      rim). Brand, landing, desk, centrepieces.
//   cracked           — the halves jarred apart with ember flecks in
//                      the wound; breaks apart once on mount. Burn
//                      and destruction contexts only.
//   ring              — one broken fragment of the outer ring alone,
//                      stroked in currentColor so it can carry any
//                      member ink (--ink-0..7) or a watermark tone.
//
// Geometry: hand-tuned beziers on a 96×96 grid, centre (48,48). The
// outer contour is deliberately not a circle — joint radii wobble
// (33.3 / 35.1 against a nominal 34) and handle lengths are perturbed
// a few percent: letterpressed wax, not a compass drawing. The
// fracture runs along the −62° diagonal; both halves (and both disc
// faces) are pulled back 4° from it, so the crack is nearly closed at
// the heart and opens toward the rim, the way real wax splits.

import { cn } from "@/lib/utils";

/* Half A (upper-left) of the outer ring — an open arc, butt ends. */
const RING_A =
  "M 61.83 16.94 C 45.77 9.79, 26.25 16.63, 18.07 33.4 C 9.81 50.33, 16.67 69.85, 32.04 78.02";
/* Half B (lower-right). */
const RING_B =
  "M 34.17 79.06 C 50.97 86.54, 70.6 80.27, 78.99 64.48 C 87.21 49.02, 82.07 29.2, 66.02 19.17";
/* The inner disc, split along the same diagonal (r = 13). */
const DISC_A =
  "M 53.29 36.12 C 46.89 33.28, 39.39 36.01, 36.32 42.3 C 33.25 48.6, 35.71 56.19, 41.9 59.48 Z";
const DISC_B =
  "M 42.71 59.88 C 48.95 62.65, 56.27 60.13, 59.48 54.1 C 62.68 48.07, 60.68 40.59, 54.89 36.98 Z";
/* The lone fragment the ring variant carries — half A's arc with the
   ends pulled back further, so the break still reads at 13px. */
const RING_FRAGMENT =
  "M 59.63 16.05 C 43.93 10.34, 25.84 17.47, 18.07 33.4 C 10.83 48.24, 15.05 65.4, 27.07 74.79";
/* The ember — a slim diamond lying in the fracture just above the
   disc: the heat inside the seal. */
const GLINT = "M 57.15 30.78 L 54.36 33.26 L 53.87 36.96 L 56.66 34.48 Z";

/* Seated pose (intact): the offsets the halves took when the wax
   cracked — the seam opens a touch wider toward the upper right. */
const SEAT_A = "translate(-0.4 -0.21) rotate(-1.2 48 48)";
const SEAT_B = "translate(0.44 0.23) rotate(1.4 48 48)";
/* Broken pose (cracked): jarred loose about each half's own centre,
   then drifted apart along the fracture's perpendicular. */
const BREAK_A = "translate(-2.7 -1.45) rotate(-8 30.9 39.7)";
const BREAK_B = "translate(3 1.6) rotate(9 64.8 56.9)";

export function SealMark({
  size = 64,
  breathe = false,
  variant = "intact",
  ink = "var(--forest)",
  className,
  style,
}: {
  size?: number;
  breathe?: boolean;
  variant?: "intact" | "cracked" | "ring";
  /** Seal body colour (ring + disc). The ring variant ignores it and
   *  takes currentColor, so member inks can drive it from outside. */
  ink?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  // The fragment: one broken shard of the rim, in whatever ink the
  // surrounding text already carries.
  if (variant === "ring") {
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
        <path d={RING_FRAGMENT} stroke="currentColor" strokeWidth={7.5} />
      </svg>
    );
  }

  const cracked = variant === "cracked";
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
      {/* half A — rim shard + its share of the disc */}
      <g
        transform={cracked ? BREAK_A : SEAT_A}
        className={cracked ? "seal-half-a" : undefined}
      >
        <path d={RING_A} stroke={ink} strokeWidth={7.5} />
        <path d={DISC_A} fill={ink} />
      </g>
      {/* half B */}
      <g
        transform={cracked ? BREAK_B : SEAT_B}
        className={cracked ? "seal-half-b" : undefined}
      >
        <path d={RING_B} stroke={ink} strokeWidth={7.5} />
        <path d={DISC_B} fill={ink} />
      </g>
      {/* the heat in the wound — flares and dies when the seal breaks */}
      <path
        d={GLINT}
        fill="var(--ember)"
        className={cracked ? "seal-glint" : undefined}
      />
      {/* ember flecks, cracked only: quiet sparks on short fade paths
          (drift set per fleck via --fx/--fy custom properties) */}
      {cracked ? (
        <>
          <circle
            cx="50.58"
            cy="41.44"
            r="1.1"
            fill="var(--ember)"
            className="seal-fleck"
            style={{ "--fx": "1.6px", "--fy": "-2.6px", animationDelay: "380ms" } as React.CSSProperties}
          />
          <circle
            cx="59.33"
            cy="27.97"
            r="1.4"
            fill="var(--terracotta)"
            className="seal-fleck"
            style={{ "--fx": "3.4px", "--fy": "-1.4px", animationDelay: "520ms" } as React.CSSProperties}
          />
          <circle
            cx="61.17"
            cy="22.16"
            r="1"
            fill="var(--ember)"
            className="seal-fleck"
            style={{ "--fx": "2.2px", "--fy": "-3.8px", animationDelay: "640ms" } as React.CSSProperties}
          />
        </>
      ) : null}
    </svg>
  );
}
