// Proof-of-possession for the graded abuse report.
//
// Round 31 shipped the report endpoint as an anonymous kill switch:
// anyone holding a room ID — the weakest credential in the system,
// one that rides in every forwarded invite link — could burn the room
// with a single unauthenticated POST. The Task 31 acceptance review
// called it correctly: that hands the weakest credential the strongest
// action. This module is the member half of the fix (see DESIGN.md §6):
//
//   - a report carrying an ECDSA signature from a REGISTERED room key
//     over the canonical string below is credible — members are the
//     only humans who can see content, so they are the only credible
//     content reporters, and member-initiated burn was already priced
//     into the documented insider threat model. The REST route burns
//     immediately on a valid proof.
//   - an unsigned report is queued (distinct-IP corroboration, three
//     needed) and only burns at the threshold.
//
// The string, window, and shape deliberately mirror leave-proof.ts
// (cc-leave-v1): same WebCrypto ECDSA P-256 SHA-256 helpers, same
// ±10-minute tolerance, same never-throws verifier, and — critically —
// a DIFFERENT domain prefix, so no leave proof can be replayed as a
// report proof or vice versa.

import { signCanonical, verifyCanonical } from "./crypto";

/** Replay window for a report proof — identical to the leave proof's. */
export const REPORT_PROOF_TOLERANCE_MS = 10 * 60_000;

/** How many distinct IPs an unsigned report needs before the room
 * burns. One stranger with a grudge and a script is noise; three
 * independent networks reporting the same room is corroboration. */
export const ANONYMOUS_REPORT_IP_THRESHOLD = 3;

/** How long an anonymous tally stays live before it resets: a
 * day-old single gripe is stale corroboration, not evidence — and the
 * bound keeps a never-burning live room from accumulating state
 * forever. */
export const REPORT_TALLY_WINDOW_MS = 24 * 60 * 60_000;

/** The mutable half of the anonymous corroboration tally (owned by
 * the report route, in-memory by design: a web-tier restart resets
 * it — an operator-visible tradeoff accepted because the member-signed
 * path and the token-guarded relay /terminate are the primary abuse
 * paths). */
export interface AnonymousReportTally {
  ips: Set<string>;
  firstAt: number;
}

/** Adjudicate one anonymous report against a room's tally. Pure: takes
 *  the current state (or null), the reporting IP, and now; returns the
 *  next state and whether THIS report crossed the corroboration
 *  threshold. Same-IP repeats never add weight — corroboration is
 *  counted in networks, not requests. */
export function tallyAnonymousReport(
  state: AnonymousReportTally | null | undefined,
  ip: string,
  now: number,
): { next: AnonymousReportTally; burn: boolean } {
  let base = state;
  if (!base || now - base.firstAt > REPORT_TALLY_WINDOW_MS) {
    base = { ips: new Set(), firstAt: now };
  }
  const next: AnonymousReportTally = {
    ips: new Set(base.ips),
    firstAt: base.firstAt,
  };
  next.ips.add(ip);
  return { next, burn: next.ips.size >= ANONYMOUS_REPORT_IP_THRESHOLD };
}

/** The exact bytes a report signature covers. */
export function reportProofInput(roomId: string, memberId: string, ts: number): string {
  return `cc-report-v1:${roomId}:${memberId}:${ts}`;
}

/** Sign a report proof with the member's room signing key. */
export async function signReportProof(
  privJwk: JsonWebKey,
  roomId: string,
  memberId: string,
  ts: number = Date.now(),
): Promise<{ ts: number; sig: string }> {
  const sig = await signCanonical(privJwk, reportProofInput(roomId, memberId, ts));
  return { ts, sig };
}

/** Verify a report proof against a registered pubkey. Returns false —
 *  never throws — for a non-JWK pubkey, malformed base64, a wrong
 *  signature, or a timestamp outside the tolerance window. */
export async function verifyReportProof(
  pubJwk: unknown,
  sigB64: string,
  roomId: string,
  memberId: string,
  ts: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (!pubJwk || typeof pubJwk !== "object") return false;
  if (typeof sigB64 !== "string" || !Number.isFinite(ts)) return false;
  if (Math.abs(now - ts) > REPORT_PROOF_TOLERANCE_MS) return false;
  return verifyCanonical(pubJwk as JsonWebKey, reportProofInput(roomId, memberId, ts), sigB64);
}
