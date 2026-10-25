// Argon2id parameter bounds for key bundles — the ONE shared
// definition used by both the server (verifier validation) and the
// client (unlock clamping). Pure constants + a pure predicate, so no
// side of the boundary can drift from the other.
//
// Why bounds at all: the verifier bundle stored on a room is a public
// offline oracle, and its m/t/p are honored verbatim by every joiner
// (kdf.ts). Unbounded trust means a hostile bundle could set m=8/t=1
// (each password guess ~1000x cheaper than policy) or m=2^30 (every
// joiner's tab OOMs). A bundle may never buy guessing discounts or
// client-denial below/above these floors and ceilings.

export const ARGON2_LIMITS = {
  /** memory in KiB: floor 16 MiB (below the 64 MiB default but still
   *  memory-hard), ceiling 128 MiB (mobile-tab survivable) */
  m: [16_384, 131_072] as const,
  /** passes: floor 2, ceiling 16 */
  t: [2, 16] as const,
  /** parallelism: 1..4 (hash-wasm is single-threaded in the browser;
   *  p only shapes the layout) */
  p: [1, 4] as const,
};

export interface Argon2LikeParams {
  m?: unknown;
  t?: unknown;
  p?: unknown;
}

/** Are these bundle params within policy? Accepts unknowns (untrusted
 *  JSON): non-finite or out-of-bounds values are refused. */
export function argon2ParamsWithinLimits(v: Argon2LikeParams): boolean {
  const { m, t, p } = v;
  return (
    typeof m === "number" && Number.isFinite(m) &&
    typeof t === "number" && Number.isFinite(t) &&
    typeof p === "number" && Number.isFinite(p) &&
    m >= ARGON2_LIMITS.m[0] && m <= ARGON2_LIMITS.m[1] &&
    t >= ARGON2_LIMITS.t[0] && t <= ARGON2_LIMITS.t[1] &&
    p >= ARGON2_LIMITS.p[0] && p <= ARGON2_LIMITS.p[1]
  );
}

/** Clamp untrusted bundle params into policy: never cheaper than the
 *  floor, never heavier than the ceiling, NaN-safe (falls back to the
 *  product defaults). The floor-raise is the security property: a
 *  tampered bundle cannot make derivation cheap. */
export function clampArgon2Params(v: Argon2LikeParams, defaults: { m: number; t: number; p: number }): {
  m: number;
  t: number;
  p: number;
} {
  const clamp = (x: unknown, [lo, hi]: readonly [number, number], d: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  return {
    m: clamp(v.m, ARGON2_LIMITS.m, defaults.m),
    t: clamp(v.t, ARGON2_LIMITS.t, defaults.t),
    p: clamp(v.p, ARGON2_LIMITS.p, defaults.p),
  };
}
