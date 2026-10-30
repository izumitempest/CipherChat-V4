// Proof that the joiner knows the room password.
//
// The server never sees the password and cannot derive the room key.
// It can still hold a verifier: an HMAC over the key-derivation
// output, bound to the room id, in a column it does not publish. The
// client proves knowledge by HMAC-ing a timestamp and a nonce with
// that verifier, so every proof is fresh, expires in ten minutes, and
// a captured one cannot be replayed later.
//
// The public key bundle stays what it is: a known-plaintext oracle for
// offline password guessing, which the argon2 cost is there to make
// expensive. The join verifier is a separate value and never leaves
// the server.
//
// A room sealed before this change has no verifier stored, and the
// server cannot invent one. Those rooms keep the old rule: anyone
// holding the link can register a member row. New rooms carry a
// verifier from the start.

import { fromB64, toB64 } from "./crypto";

/** How long a join proof stays fresh. */
export const JOIN_PROOF_WINDOW_MS = 10 * 60_000;

const encoder = new TextEncoder();

/** The string the room verifier covers. Bound to the room, so a
 *  verifier cannot be carried to another room. */
export function joinVerifierInput(roomId: string): string {
  return `cc-join-verifier-v1:${roomId}`;
}

/** The string one join proof covers: a timestamp and a nonce, so two
 *  proofs never match and a captured one cannot be replayed. */
export function joinProofInput(roomId: string, ts: number, nonce: string): string {
  return `cc-join-proof-v1:${roomId}:${ts}:${nonce}`;
}

/** The room verifier, made from the raw key-derivation output. */
export async function joinVerifierFromRaw(raw: Uint8Array, roomId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    raw as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(joinVerifierInput(roomId)),
  );
  return toB64(new Uint8Array(mac));
}

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** A fresh join proof: the timestamp, a nonce, and the MAC over both,
 *  made with the room verifier. */
export async function makeJoinProof(
  verifierB64: string,
  roomId: string,
  ts: number = Date.now(),
  nonce: string = randomNonce(),
): Promise<{ ts: number; nonce: string; mac: string }> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromB64(verifierB64) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(joinProofInput(roomId, ts, nonce)),
  );
  return { ts, nonce, mac: toB64(new Uint8Array(mac)) };
}

/** One proof, as it travels: "<ts>.<nonce>.<mac>". */
export function encodeJoinProof(proof: { ts: number; nonce: string; mac: string }): string {
  return `${proof.ts}.${proof.nonce}.${proof.mac}`;
}

/** Read a proof back. Null when it is not shaped like one. */
export function decodeJoinProof(raw: string | null | undefined): {
  ts: number;
  nonce: string;
  mac: string;
} | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const ts = Number(parts[0]);
  if (!Number.isFinite(ts)) return null;
  if (!parts[1] || parts[1].length > 64) return null;
  if (!parts[2] || parts[2].length > 128) return null;
  return { ts, nonce: parts[1], mac: parts[2] };
}

/** Compare two strings without leaking where they differ. */
function equalInConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a join proof against the stored room verifier. Returns false
 *  (never throws) for a missing verifier, a malformed proof, a stale or
 *  future timestamp, or a wrong MAC. */
export async function verifyJoinProof(
  verifierB64: string | null | undefined,
  raw: string | null | undefined,
  roomId: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!verifierB64) return false;
  const proof = decodeJoinProof(raw);
  if (!proof) return false;
  if (Math.abs(now - proof.ts) > JOIN_PROOF_WINDOW_MS) return false;
  let expected: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      fromB64(verifierB64) as unknown as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(joinProofInput(roomId, proof.ts, proof.nonce)),
    );
    expected = toB64(new Uint8Array(mac));
  } catch {
    return false;
  }
  return equalInConstantTime(expected, proof.mac);
}
