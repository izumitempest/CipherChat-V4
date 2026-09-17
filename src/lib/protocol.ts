// CipherChat wire protocol, version 2.
//
// Everything the relay carries is a uniform padded encrypted frame:
//
//   body JSON ──sign──▶ pad to a FIXED size ──▶ AES-256-GCM ──▶ wire
//
// Frame classes and their fixed plaintext sizes:
//   control frames (text, typing, spent, burn, key offers, file meta)
//     → CONTROL_FRAME_BYTES (20480). Chosen because the composer allows
//       4000 characters, which is up to 16 KB of UTF-8 — 4096 could not
//       contain the product's own maximum message. Uniformity is the
//       property; the size must simply dominate every control payload.
//   file chunk frames → FILE_FRAME_BYTES (65536), and every file —
//     regardless of true size — is padded to the same total payload
//     length and split into the same FIXED number of chunks, so the
//     relay cannot read file sizes off the wire.
//
// Replay defense lives here too: every frame body carries a per-sender
// monotonic counter inside a per-session tag, a timestamp checked
// against a ±10 minute window, and a unique frame id.

import {
  signCanonical,
  verifyCanonical,
  toB64,
  fromB64,
} from "./crypto";

export { toB64, fromB64 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------- constants ---------------- */

export const CONTROL_FRAME_BYTES = 20480;
export const FILE_FRAME_BYTES = 65536;
/** base64 characters of file payload carried per chunk frame */
export const FILE_CHUNK_B64 = 64000;
/** FIXED total base64 length every file transfer is padded to.
 *  Must dominate ceil(2 MiB / 3) * 4 — the largest allowed file. */
export const FILE_PAYLOAD_B64 = 2_800_000;
export const FILE_TOTAL_CHUNKS = Math.ceil(FILE_PAYLOAD_B64 / FILE_CHUNK_B64);

export const TS_WINDOW_MS = 10 * 60 * 1000;
export const KEY_GRACE_MS = 30_000;
export const PENDING_TTL_MS = 5_000;
export const PENDING_MAX = 64;

/* ---------------- wire + body types ---------------- */

export type FrameKind =
  | "text"
  | "typing"
  | "spent"
  | "burn"
  | "key:offer"
  | "file:meta"
  | "file:chunk";

export interface OfferBody {
  to: string;
  /** the key version this offer installs */
  kv: number;
  /** rotation offer (from the coordinator) vs join delivery */
  rot: boolean;
  /** sender's session ECDH public key — must match the registry (UKS defense) */
  ecdhPubB64?: string;
  /** ECDH-wrapped { keyB64, kv, rot, issuedAt } */
  wrapIv?: string;
  wrapCt?: string;
  /** join deliveries are additionally wrapped under the password-derived
   *  entry key, so only a joiner who proved the password can open them */
  outerIv?: string;
  outerCt?: string;
}

export interface FileMetaBody {
  messageId: string;
  name: string;
  mime: string;
  size: number;
  sha: string;
  ttlSec?: number;
  viewOnce?: boolean;
}

export interface FrameBody {
  kind: FrameKind;
  senderId: string;
  sessionTag: string;
  counter: number;
  ts: number;
  kv: number;
  sig: string;
  text?: string;
  fileSha?: string;
  ttlSec?: number;
  viewOnce?: boolean;
  messageId?: string;
  burnSig?: string;
  typing?: boolean;
  offer?: OfferBody;
  file?: FileMetaBody;
  chunk?: { messageId: string; seq: number; total: number; dataB64: string };
}

export interface WireFrame {
  v: 2;
  roomId: string;
  /** key version this frame is sealed under. 0 = sealed under the
   *  password-derived ENTRY key (key-delivery offers) — readable by
   *  any password holder at any time; the secret inside is still
   *  ECDH-wrapped pairwise. */
  kv: number;
  from: string;
  id: string;
  /** frame issue time, in the clear — lets receivers expire stale
   *  undecryptable frames without opening them */
  ts: number;
  iv: string;
  ct: string;
  to?: string;
}

/* ---------------- padding ---------------- */

/** length-prefix (4 LE) + content + random fill, always exactly `size`. */
export function padToSize(bytes: Uint8Array, size: number): Uint8Array {
  const needed = 4 + bytes.length;
  if (needed > size) {
    throw new Error(`payload (${bytes.length}B) exceeds frame size (${size}B)`);
  }
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  if (needed < size) crypto.getRandomValues(out.subarray(needed));
  return out;
}

/** Inverse of padToSize. Never throws — the GCM tag is the integrity
 *  check; a bogus length prefix just yields garbage bytes. */
export function unpadFromSize(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4) return new Uint8Array(0);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = dv.getUint32(0, true);
  if (len > bytes.length - 4) return new Uint8Array(0);
  return bytes.subarray(4, 4 + len);
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Random base64 filler — never decoded, exists only for uniform length.
 *  (getRandomValues is capped at 65536 bytes per call, so fill in blocks.) */
function randomB64Chars(n: number): string {
  let s = "";
  const block = new Uint8Array(Math.min(n, 65536));
  while (s.length < n) {
    const take = Math.min(block.length, n - s.length);
    crypto.getRandomValues(block.subarray(0, take));
    for (let i = 0; i < take; i++) s += B64_ALPHABET[block[i] & 63];
  }
  return s;
}

/** Pad a base64 payload to a fixed total length. The true length is
 *  recovered by slicing (base64 is prefix-decodable at quad boundaries). */
export function padB64Payload(dataB64: string, totalLength: number): string {
  if (dataB64.length > totalLength) {
    throw new Error("file payload exceeds the fixed transfer size");
  }
  return dataB64 + randomB64Chars(totalLength - dataB64.length);
}

/* ---------------- replay defense ---------------- */

export interface ReplayMeta {
  senderId: string;
  sessionTag: string;
  counter: number;
  ts: number;
  id: string;
}

export interface ReplayGuard {
  check(m: ReplayMeta): boolean;
}

/** Per-sender monotonic counters (scoped to a session tag), a ±10 min
 *  timestamp window, and a capped frame-id dedup set. Rejects any
 *  re-injection of captured traffic. The counter map can be seeded
 *  from (and reported to) a persistence layer, so a page refresh does
 *  not reset the defense. */
export function createReplayGuard(opts?: {
  now?: () => number;
  idCapacity?: number;
  initialHigh?: Map<string, number>;
  onAccept?: (key: string, counter: number) => void;
}): ReplayGuard {
  const now = opts?.now ?? Date.now;
  const capacity = opts?.idCapacity ?? 2048;
  const highest = new Map<string, number>(opts?.initialHigh ?? []);
  const seen = new Set<string>();
  const order: string[] = [];
  return {
    check(m) {
      if (!m || typeof m.counter !== "number" || typeof m.ts !== "number") return false;
      const t = now();
      if (Math.abs(t - m.ts) > TS_WINDOW_MS) return false;
      const key = `${m.senderId}:${m.sessionTag}`;
      const hi = highest.get(key);
      if (hi !== undefined && m.counter <= hi) return false;
      if (seen.has(m.id)) return false;
      highest.set(key, m.counter);
      seen.add(m.id);
      order.push(m.id);
      if (order.length > capacity) {
        const drop = order.splice(0, order.length - capacity);
        for (const d of drop) seen.delete(d);
      }
      opts?.onAccept?.(key, m.counter);
      return true;
    },
  };
}

export interface SendClock {
  sessionTag: string;
  next(): number;
}

/** Per page-load session tag + monotonic counter. A new page load gets
 *  a fresh tag, so counters never collide across refreshes. */
export function createSendClock(): SendClock {
  const sessionTag = toB64(crypto.getRandomValues(new Uint8Array(16)));
  let counter = 0;
  return { sessionTag, next: () => ++counter };
}

/* ---------------- canonical signing string ---------------- */

export function canonicalV2(f: {
  roomId: string;
  kv: number;
  senderId: string;
  sessionTag: string;
  counter: number;
  ts: number;
  kind: string;
  text?: string;
  fileSha?: string;
  messageId?: string;
}): string {
  return [
    "v2",
    f.roomId,
    f.kv,
    f.senderId,
    f.sessionTag,
    f.counter,
    f.ts,
    f.kind,
    f.text ?? "",
    f.fileSha ?? "",
    f.messageId ?? "",
  ].join("|");
}

/* ---------------- seal / open ---------------- */

export async function sealFrame(opts: {
  key: CryptoKey;
  roomId: string;
  kv: number;
  senderId: string;
  clock: SendClock;
  body: Record<string, unknown>;
  frameSize: number;
  frameId?: string;
  to?: string;
  sigPrivJwk?: JsonWebKey;
}): Promise<WireFrame> {
  const counter = opts.clock.next();
  const ts = Date.now();
  const kind = String(opts.body.kind ?? "");
  const text = typeof opts.body.text === "string" ? opts.body.text : undefined;
  const fileSha = typeof opts.body.fileSha === "string" ? opts.body.fileSha : undefined;
  const messageId = typeof opts.body.messageId === "string" ? opts.body.messageId : undefined;

  const canonical = canonicalV2({
    roomId: opts.roomId,
    kv: opts.kv,
    senderId: opts.senderId,
    sessionTag: opts.clock.sessionTag,
    counter,
    ts,
    kind,
    text,
    fileSha,
    messageId,
  });
  const sig = opts.sigPrivJwk ? await signCanonical(opts.sigPrivJwk, canonical) : "";

  const body: FrameBody = {
    ...(opts.body as object),
    kind: kind as FrameKind,
    senderId: opts.senderId,
    sessionTag: opts.clock.sessionTag,
    counter,
    ts,
    kv: opts.kv,
    sig,
  };

  const padded = padToSize(encoder.encode(JSON.stringify(body)), opts.frameSize);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    opts.key,
    padded as unknown as BufferSource,
  );
  return {
    v: 2,
    roomId: opts.roomId,
    kv: opts.kv,
    from: opts.senderId,
    id: opts.frameId ?? crypto.randomUUID(),
    ts,
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
    to: opts.to,
  };
}

/** Decrypt + unpad + cross-check the authenticated kv/sender binding.
 *  Returns null on any failure (GCM tag, shape, binding). Signature
 *  verification is the caller's job (it needs the registry). */
export async function openFrame(
  key: CryptoKey,
  frame: WireFrame,
): Promise<FrameBody | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(frame.iv) },
      key,
      fromB64(frame.ct),
    );
    const body = JSON.parse(decoder.decode(unpadFromSize(new Uint8Array(pt)))) as FrameBody;
    if (!body || typeof body.kind !== "string") return null;
    if (body.kv !== frame.kv || body.senderId !== frame.from) return null;
    return body;
  } catch {
    return null;
  }
}

/* ---------------- session ECDH (key delivery) ---------------- */

export interface SessionEcdh {
  privJwk: JsonWebKey;
  pubRawB64: string;
}

/** Ephemeral ECDH P-256 pair — regenerated on every page load, held
 *  only in memory. Used to deliver room keys pairwise. */
export async function generateSessionEcdh(): Promise<SessionEcdh> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privJwk, pubRawB64: toB64(raw) };
}

async function ecdhAesKey(
  myPrivJwk: JsonWebKey,
  theirPubRawB64: string,
  roomId: string,
  kv: number,
): Promise<CryptoKey> {
  const priv = await crypto.subtle.importKey(
    "jwk",
    myPrivJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const pub = await crypto.subtle.importKey(
    "raw",
    fromB64(theirPubRawB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(`cc-key-delivery:${roomId}:${kv}`),
      info: encoder.encode("cipherchat-v2"),
    },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function ecdhWrapKey(opts: {
  myPrivJwk: JsonWebKey;
  theirPubRawB64: string;
  roomId: string;
  kv: number;
  payload: Record<string, unknown>;
}): Promise<{ wrapIv: string; wrapCt: string }> {
  const key = await ecdhAesKey(opts.myPrivJwk, opts.theirPubRawB64, opts.roomId, opts.kv);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(opts.payload)),
  );
  return { wrapIv: toB64(iv), wrapCt: toB64(new Uint8Array(ct)) };
}

export async function ecdhUnwrapKey(opts: {
  myPrivJwk: JsonWebKey;
  theirPubRawB64: string;
  roomId: string;
  kv: number;
  wrapIv: string;
  wrapCt: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const key = await ecdhAesKey(opts.myPrivJwk, opts.theirPubRawB64, opts.roomId, opts.kv);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(opts.wrapIv) },
      key,
      fromB64(opts.wrapCt),
    );
    return JSON.parse(decoder.decode(pt)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ---------------- AES helpers ---------------- */

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
