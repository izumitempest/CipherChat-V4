// Room key derivation, version 2.
//
// New rooms derive their entry key (key version 1) with argon2id
// (m = 64 MB, t = 3, p = 1) via hash-wasm, from the password and a
// RANDOM 16-byte salt that lives in a versioned key bundle. 64 MB of
// memory hardness is the point: the verifier blob stored on the room
// is a public offline oracle for password guessing, and argon2id at
// this cost makes each guess ~1000× more expensive than PBKDF2 on a
// GPU farm.
//
// Rooms created before this change (PBKDF2-SHA256, 750k iterations,
// deterministic salt `cipherchat:v1:<roomId>:<epoch>`) keep working:
// the bundle carries no version, and the unlock path detects legacy
// blobs and derives the old way.

import { argon2id } from "hash-wasm";
import { deriveRoomKey, checkVerifier, toB64, fromB64 } from "./crypto";

export const ARGON2_PARAMS = { m: 65_536, t: 3, p: 1 } as const;

const VERIFY_CHECK_V2 = "cipherchat-verify-v2";

export interface KeyBundleV2 {
  v: 2;
  alg: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: string; // b64, 16 random bytes
  iv: string; // b64 — known-plaintext check
  ct: string; // b64
}

async function deriveArgon2(
  password: string,
  salt: Uint8Array,
  params: { m: number; t: number; p: number },
): Promise<CryptoKey> {
  const raw = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Create a version-2 bundle for a new room. Returns the derived entry
 *  key and the blob the server will store (and anyone can fetch — the
 *  salt is not secret, only memory-hard). */
export async function createKeyBundleV2(
  password: string,
): Promise<{ key: CryptoKey; bundle: KeyBundleV2 }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveArgon2(password, salt, ARGON2_PARAMS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify({ check: VERIFY_CHECK_V2 })),
  );
  return {
    key,
    bundle: {
      v: 2,
      alg: "argon2id",
      m: ARGON2_PARAMS.m,
      t: ARGON2_PARAMS.t,
      p: ARGON2_PARAMS.p,
      salt: toB64(salt),
      iv: toB64(iv),
      ct: toB64(new Uint8Array(ct)),
    },
  };
}

/** Unlock a room with its bundle. Versioned: v2 bundles derive with
 *  argon2id using the parameters and salt IN the bundle; versionless
 *  blobs are legacy PBKDF2 rooms and derive the old way (their salt is
 *  deterministic from roomId + epoch). Returns null on wrong password. */
export async function unlockWithBundle(
  password: string,
  bundleJson: string | null | undefined,
  roomId: string,
  epoch: number,
): Promise<CryptoKey | null> {
  if (!bundleJson) return null;
  let blob: Record<string, unknown>;
  try {
    blob = JSON.parse(bundleJson);
  } catch {
    return null;
  }

  if (blob?.v === 2 && blob.alg === "argon2id") {
    const key = await deriveArgon2(password, fromB64(String(blob.salt)), {
      m: Number(blob.m),
      t: Number(blob.t),
      p: Number(blob.p),
    });
    try {
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(String(blob.iv)) },
        key,
        fromB64(String(blob.ct)),
      );
      const parsed = JSON.parse(new TextDecoder().decode(pt));
      return parsed?.check === VERIFY_CHECK_V2 ? key : null;
    } catch {
      return null;
    }
  }

  // Legacy v1 room: PBKDF2 with the deterministic salt.
  const key = await deriveRoomKey(roomId, epoch, password);
  return (await checkVerifier(key, bundleJson)) ? key : null;
}
