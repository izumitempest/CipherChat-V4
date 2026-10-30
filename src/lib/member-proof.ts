// Proof-of-possession for a member update.
//
// The member registry is writable by anyone who knows the room id. The
// roster is public, so a stranger can read a member's registered pubkey
// and post it back. Before this proof, that post found the member row
// and overwrote it: the alias, the ink index and the ECDH key. The
// ECDH key is what a key offer is encrypted to, so overwriting it hands
// the room key to whoever posted last.
//
// The update therefore carries an ECDSA signature from the member's own
// registered key, over a string that binds the room and the new ECDH
// key. A captured proof cannot be replayed onto a different ECDH key,
// and a proof from another key does not verify here.
//
// Same shape as the leave proof, different domain prefix:
// `cc-member-v1` and `cc-leave-v1` never replay as each other.
//
// Pure module with an injectable clock (`now`), so the properties are
// unit-testable. Signing and verification reuse the WebCrypto ECDSA
// P-256 SHA-256 helpers from crypto.ts.

import { signCanonical, verifyCanonical } from "./crypto";

/** Replay window for a member proof. A captured {ts, sig} is refused
 *  outside it.
 *
 *  The window is a day, not the ten minutes the leave proof uses, and
 *  that is on purpose: a device with a wrong clock must not lock its
 *  owner out of a room they are already in. A replay inside the window
 *  buys the attacker very little. The signature names the ECDH key
 *  being written, so a captured proof can only write the member's own
 *  old ECDH key back, which costs that member a stalled key offer
 *  until they re-join. It cannot write the attacker's ECDH key, which
 *  is the whole prize. */
export const MEMBER_PROOF_TOLERANCE_MS = 24 * 60 * 60_000;

/** The exact bytes a member-update signature covers. */
export function memberProofInput(roomId: string, ecdhPub: string, ts: number): string {
  return `cc-member-v1:${roomId}:${ecdhPub}:${ts}`;
}

/** Sign a member-update proof with the member's room signing key.
 *  Accepts either a JWK (tests) or a non-extractable CryptoKey (vault
 *  path); the signing material's form matches where it came from. */
export async function signMemberProof(
  priv: JsonWebKey | CryptoKey,
  roomId: string,
  ecdhPub: string,
  ts: number = Date.now(),
): Promise<{ ts: number; sig: string }> {
  const sig = await signCanonical(priv, memberProofInput(roomId, ecdhPub, ts));
  return { ts, sig };
}

/** Verify a member-update proof against a registered pubkey. Returns
 *  false (never throws) for a non-JWK pubkey, malformed base64, a
 *  wrong signature, a different ECDH key, or a timestamp outside the
 *  tolerance window. */
export async function verifyMemberProof(
  pubJwk: unknown,
  sigB64: string,
  roomId: string,
  ecdhPub: string,
  ts: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (!pubJwk || typeof pubJwk !== "object") return false;
  if (typeof sigB64 !== "string" || !Number.isFinite(ts)) return false;
  if (typeof ecdhPub !== "string" || ecdhPub.length === 0) return false;
  // The window is signed-time vs verifier-time; a stale or future
  // proof is refused before any crypto runs.
  if (Math.abs(now - ts) > MEMBER_PROOF_TOLERANCE_MS) return false;
  return verifyCanonical(
    pubJwk as JsonWebKey,
    memberProofInput(roomId, ecdhPub, ts),
    sigB64,
  );
}
