// Per-room signing identity.
//
// The device seed is a 32-byte random value. Each room derives its own
// ECDSA P-256 keypair from it:
//
//   scalar = HKDF-SHA256(seed, salt = roomId, info = "cc-sig-v1")
//
// The seed is held as a NON-EXTRACTABLE WebCrypto key in IndexedDB
// (see seed-vault.ts), so scripts cannot read the bytes back. The
// fallback when IndexedDB is unavailable is an in-memory seed for the
// page load only.
//
// The public key (x, y) is recovered from the scalar with @noble/curves
// and imported into WebCrypto as a JWK. Consequences:
//
//   same device, same room  → same key (verification marks survive
//                             refresh; "returned" recognition works)
//   same device, two rooms  → DIFFERENT pubkeys, different aliases.
//                             The server's member registries cannot be
//                             correlated across rooms, undoing the V3
//                             linkability regression
//
// The session ECDH keypair (used for key delivery) is separate and
// regenerated on every page load; see protocol.ts.

import { p256 } from "@noble/curves/nist.js";
import { sha256Hex } from "./identity";
import { deriveScalarFromSeedKey } from "./seed-vault";

const SEED_KEY = "cc.seed";
const encoder = new TextEncoder();

export interface RoomSigningIdentity {
  privJwk: JsonWebKey;
  pubJwk: JsonWebKey;
  fingerprintHex: string; // full 64-char hex
  fingerprint: string; // 8-char display form
}

/** The vault-path identity: the room's signing key held as a
 *  NON-EXTRACTABLE CryptoKey, with no JSON form anywhere. The public
 *  half stays a JWK because it is published to the room registry. */
export interface RoomSigningSecrets {
  privKey: CryptoKey;
  pubJwk: JsonWebKey;
  fingerprintHex: string;
  fingerprint: string;
}

/** The device seed. In old versions this was stored in localStorage as
 *  `cc.seed`; it is now migrated into the IndexedDB seed vault, so this
 *  function exists only for tests. Rooms get per-room keys from it.
 *  Keys never leave the device. */
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
    /* private mode: seed lives for this page load only */
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

/** Big-endian unsigned integer decode (for 32-byte candidate
 *  scalars). BigInt() calls instead of literals, because the repo
 *  targets ES2017. */
function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = BigInt(0);
  for (let i = 0; i < bytes.length; i++) n = (n << BigInt(8)) | BigInt(bytes[i]);
  return n;
}

/** Build a room signing identity from a candidate scalar, or null when
 *  the scalar is outside the valid P-256 private range. The range check
 *  is EXPLICIT (a P-256 private scalar must be an integer in [1, n-1]),
 *  rather than an incidental side effect of @noble/curves throwing.
 *  Deterministic: the same scalar always yields the same identity.
 *  (Async only because the WebCrypto importKey proof is.) */
export async function scalarToRoomIdentity(
  scalar: Uint8Array,
): Promise<RoomSigningIdentity | null> {
  // all-zero (or empty) scalar: not a valid private key
  if (scalar.every((b) => b === 0)) return null;
  // d must be < n (the P-256 subgroup order): checked, not thrown
  if (bytesToBigIntBE(scalar) >= p256.Point.CURVE().n) return null;
  try {
    // noble recovers the public point from the (now provably in-range)
    // scalar.
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
    return null;
  }
}

/** Derive this room's signing keypair from the device seed. Deterministic:
 *  the same (seed, roomId) always yields the same key.
 *
 *  NOTE: this is the test/verification path; it exposes the JWK so
 *  assertions can read d. The app uses deriveRoomSigningKeyFromSeed
 *  (below), which returns a non-extractable CryptoKey instead. */
export async function deriveRoomSigningKey(
  seed: Uint8Array,
  roomId: string,
): Promise<RoomSigningIdentity> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const info = attempt === 0 ? "cc-sig-v1" : `cc-sig-v1:${attempt}`;
    const scalar = await hkdf(seed, encoder.encode(roomId), encoder.encode(info));
    const identity = await scalarToRoomIdentity(scalar);
    if (identity) return identity; // invalid scalar → derive again
  }
  throw new Error("could not derive a valid room signing key");
}

/** Vault path: derive the room's signing key from the non-extractable
 *  seed key in the vault, keeping the room key non-extractable too.
 *  Scalars pass through the same 8-attempt rejection-sampling loop as
 *  the byte-based path, so identities (fingerprints, aliases) are
 *  unchanged across the migration. */
export async function deriveRoomSigningKeyFromSeed(
  seedKey: CryptoKey,
  roomId: string,
): Promise<RoomSigningSecrets> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const info = attempt === 0 ? "cc-sig-v1" : `cc-sig-v1:${attempt}`;
    const scalar = await deriveScalarFromSeedKey(seedKey, roomId, info);
    const identity = await scalarToRoomSigningSecrets(scalar);
    scalar.fill(0); // derived bits are no longer needed after import
    if (identity) return identity;
  }
  throw new Error("could not derive a valid room signing key");
}

/** Import a candidate scalar as a NON-EXTRACTABLE WebCrypto ECDSA key
 *  and return it with its public half. Returns null when the scalar is
 *  outside the valid P-256 range, same rule as scalarToRoomIdentity. */
async function scalarToRoomSigningSecrets(
  scalar: Uint8Array,
): Promise<RoomSigningSecrets | null> {
  if (scalar.every((b) => b === 0)) return null;
  if (bytesToBigIntBE(scalar) >= p256.Point.CURVE().n) return null;
  try {
    const pubBytes = p256.getPublicKey(scalar, false); // 65 bytes, uncompressed
    const x = b64url(pubBytes.subarray(1, 33));
    const y = b64url(pubBytes.subarray(33, 65));
    const d = b64url(scalar);
    const privJwk: JsonWebKey = { kty: "EC", crv: "P-256", d, x, y };
    // Non-extractable: the private half cannot be exported back out.
    const privKey = await crypto.subtle.importKey(
      "jwk",
      privJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const pubJwk: JsonWebKey = { kty: "EC", crv: "P-256", x, y };
    const fingerprintHex = await sha256Hex(`${x}|${y}`);
    return {
      privKey,
      pubJwk,
      fingerprintHex,
      fingerprint: fingerprintHex.slice(0, 8).toUpperCase(),
    };
  } catch {
    return null;
  }
}
