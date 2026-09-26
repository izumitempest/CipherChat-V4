// Proof-of-possession for departure.
//
// The leave endpoint writes a member out of the registry and bumps the
// epoch (rotating the room key for everyone who stays), so it must
// not accept a bare memberId, which is only a server-issued handle
// that a relay observer or a stranger with the invite code could have
// learned. The departing client signs the canonical string below with
// the room's ECDSA signing key (the one whose pubkey is already
// registered), and the server verifies against that registered pubkey.
//
// Pure module with an injectable clock (`now`), so the properties are
// unit-testable. Signing/verification reuse the WebCrypto ECDSA
// P-256 SHA-256 helpers from crypto.ts (canonical string → sig, base64).

import { signCanonical, verifyCanonical } from "./crypto";

/** Replay window for a leave proof. A captured {ts, sig} is refused
 *  outside it. Inside it, replay is harmless by construction
 *  (leaving is idempotent; only the member's own key can sign). */
export const LEAVE_PROOF_TOLERANCE_MS = 10 * 60_000;

/** The exact bytes a departure signature covers. */
export function leaveProofInput(roomId: string, memberId: string, ts: number): string {
  return `cc-leave-v1:${roomId}:${memberId}:${ts}`;
}

/** Sign a departure proof with the member's room signing key. */
export async function signLeaveProof(
  privJwk: JsonWebKey,
  roomId: string,
  memberId: string,
  ts: number = Date.now(),
): Promise<{ ts: number; sig: string }> {
  const sig = await signCanonical(privJwk, leaveProofInput(roomId, memberId, ts));
  return { ts, sig };
}

/** Verify a departure proof against a registered pubkey. Returns
 *  false (never throws) for a non-JWK pubkey, malformed base64, a
 *  wrong signature, or a timestamp outside the tolerance window. */
export async function verifyLeaveProof(
  pubJwk: unknown,
  sigB64: string,
  roomId: string,
  memberId: string,
  ts: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (!pubJwk || typeof pubJwk !== "object") return false;
  if (typeof sigB64 !== "string" || !Number.isFinite(ts)) return false;
  // The window is signed-time vs verifier-time; a stale or future
  // proof is refused before any crypto runs.
  if (Math.abs(now - ts) > LEAVE_PROOF_TOLERANCE_MS) return false;
  return verifyCanonical(pubJwk as JsonWebKey, leaveProofInput(roomId, memberId, ts), sigB64);
}
