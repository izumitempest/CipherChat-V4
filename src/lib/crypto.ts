// CipherChat crypto — everything that matters happens in this tab.
//
//  Room key:  PBKDF2-SHA256 (750,000 iterations, salted by room + epoch)
//             → AES-256-GCM. Deliberately slow: sealing takes a moment
//             on purpose. The password never leaves the browser.
//  Identity:  ECDSA P-256 keypair, generated per device, stored locally.
//             Every message is signed inside the encrypted payload.
//  Forgery:   A message whose signature does not verify against the
//             sender's registered key is rejected with a quiet system line.

const PBKDF2_ITERATIONS = 750_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------- base64 helpers ---------------- */

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ---------------- device identity ---------------- */

export interface DeviceIdentity {
  privJwk: JsonWebKey;
  pubJwk: JsonWebKey;
  fingerprintHex: string; // full 64-char hex
  fingerprint: string; // 8-char display form
}

const DEVICE_KEY = "cc.device";

export async function loadDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const { privJwk, pubJwk } = JSON.parse(raw);
      const hex = await (
        await import("@/lib/identity")
      ).sha256Hex(`${pubJwk.x}|${pubJwk.y}`);
      return {
        privJwk,
        pubJwk,
        fingerprintHex: hex,
        fingerprint: hex.slice(0, 8).toUpperCase(),
      };
    }
  } catch {
    /* fall through to generation */
  }

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ privJwk, pubJwk }));
  const { sha256Hex } = await import("@/lib/identity");
  const hex = await sha256Hex(`${pubJwk.x}|${pubJwk.y}`);
  return {
    privJwk,
    pubJwk,
    fingerprintHex: hex,
    fingerprint: hex.slice(0, 8).toUpperCase(),
  };
}

/* ---------------- room key derivation ---------------- */

export async function deriveRoomKey(
  roomId: string,
  epoch: number,
  password: string,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(`cipherchat:v1:${roomId}:${epoch}`),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ---------------- verifier (wrong-password detection) ---------------- */

export async function makeVerifier(
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(
    JSON.stringify({ check: "cipherchat-verify-v1" }),
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return JSON.stringify({ iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
}

export async function checkVerifier(
  key: CryptoKey,
  blob: string,
): Promise<boolean> {
  try {
    const { iv, ct } = JSON.parse(blob);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      key,
      fromB64(ct),
    );
    const parsed = JSON.parse(decoder.decode(plaintext));
    return parsed?.check === "cipherchat-verify-v1";
  } catch {
    return false;
  }
}

/* ---------------- message encryption ---------------- */

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptJson<T>(
  key: CryptoKey,
  iv: string,
  ct: string,
): Promise<T | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      key,
      fromB64(ct),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

/* ---------------- signatures ---------------- */

export function canonicalFor(payload: {
  roomId: string;
  epoch: number;
  senderId: string;
  ts: number;
  kind: string;
  text: string;
  fileSha?: string;
}): string {
  return [
    "v1",
    payload.roomId,
    payload.epoch,
    payload.senderId,
    payload.ts,
    payload.kind,
    payload.text ?? "",
    payload.fileSha ?? "",
  ].join("|");
}

export async function signCanonical(
  privJwk: JsonWebKey,
  canonical: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    privJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(canonical),
  );
  return toB64(new Uint8Array(sig));
}

export async function verifyCanonical(
  pubJwk: JsonWebKey,
  canonical: string,
  sigB64: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      pubJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromB64(sigB64),
      encoder.encode(canonical),
    );
  } catch {
    return false;
  }
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
