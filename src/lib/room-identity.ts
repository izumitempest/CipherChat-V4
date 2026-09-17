// Per-room signing identity.
//
// The device holds ONE random 32-byte seed (localStorage, never
// leaves the device). Each room derives its own ECDSA P-256 keypair:
//
//   scalar = HKDF-SHA256(seed, salt = roomId, info = "cc-sig-v1")
//
// The public key (x, y) is recovered from the scalar with @noble/curves
// and imported into WebCrypto as a JWK. Consequences:
//
//   same device, same room  → same key (verification marks survive
//                             refresh; "returned" recognition works)
//   same device, two rooms  → DIFFERENT pubkeys, different aliases —
//                             the server's member registries cannot be
//                             correlated across rooms, undoing the V3
//                             linkability regression
//
// The session ECDH keypair (used for key delivery) is separate and
// regenerated on every page load — see protocol.ts.

import { p256 } from "@noble/curves/nist.js";
import { sha256Hex } from "./identity";

const SEED_KEY = "cc.seed";
const encoder = new TextEncoder();

export interface RoomSigningIdentity {
  privJwk: JsonWebKey;
  pubJwk: JsonWebKey;
  fingerprintHex: string; // full 64-char hex
  fingerprint: string; // 8-char display form
}

/** The device seed. Created on first use; the old global `cc.device`
 *  keypair (if present) is retired — rooms get per-room keys from now
 *  on. Keys never leave the device. */
export async function loadDeviceSeed(): Promise<Uint8Array> {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 32) {
        return Uint8Array.from(parsed);
      }
    }
  } catch {
    /* fall through to generation */
  }
  const seed = crypto.getRandomValues(new Uint8Array(32));
  try {
    localStorage.setItem(SEED_KEY, JSON.stringify(Array.from(seed)));
  } catch {
    /* private mode — seed lives for this page load only */
  }
  return seed;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    ikm as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      info: info as unknown as BufferSource,
    },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** Derive this room's signing keypair from the device seed. Deterministic:
 *  the same (seed, roomId) always yields the same key. */
export async function deriveRoomSigningKey(
  seed: Uint8Array,
  roomId: string,
): Promise<RoomSigningIdentity> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const info = attempt === 0 ? "cc-sig-v1" : `cc-sig-v1:${attempt}`;
    const scalar = await hkdf(seed, encoder.encode(roomId), encoder.encode(info));
    if (scalar.every((b) => b === 0)) continue;
    try {
      // noble validates the scalar is a valid P-256 private key
      // (throws on d = 0 or d >= n) and recovers the public point.
      const pubBytes = p256.getPublicKey(scalar, false); // 65 bytes, uncompressed
      const x = b64url(pubBytes.subarray(1, 33));
      const y = b64url(pubBytes.subarray(33, 65));
      const d = b64url(scalar);
      const privJwk: JsonWebKey = { kty: "EC", crv: "P-256", d, x, y };
      const pubJwk: JsonWebKey = { kty: "EC", crv: "P-256", x, y };
      // Prove WebCrypto accepts the derived pair before returning it.
      await crypto.subtle.importKey(
        "jwk",
        privJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
      const fingerprintHex = await sha256Hex(`${x}|${y}`);
      return {
        privJwk,
        pubJwk,
        fingerprintHex,
        fingerprint: fingerprintHex.slice(0, 8).toUpperCase(),
      };
    } catch {
      continue; // invalid scalar (probability ~2^-96) — derive again
    }
  }
  throw new Error("could not derive a valid room signing key");
}
