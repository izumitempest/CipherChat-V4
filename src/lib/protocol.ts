// CipherChat wire protocol. v3 is current.
//
// v2 is refused, not accepted. Its canonical glued variable-length
// fields together with "|" and escaped only one of them, so two
// different bodies could produce the same signing string and a
// signature made for one verified for the other. Keeping v2 readable
// would keep that hole open, so a v3 build drops v2 frames and a v2
// build drops v3 frames. The split is quiet on both sides: neither
// prints a "rejected" line for the other, the room just goes still.
//
// v3 signs the whole frame body, so every field the body carries is
// covered: the text, the ttl, the view-once flag, the file name and
// mime, the file bytes, the key offer contents, and whatever gets
// added to a frame after this line was written.
//
// Everything the relay carries is a uniform padded encrypted frame:
//
//   body JSON ──sign──▶ pad to a FIXED size ──▶ AES-256-GCM ──▶ network
//
// Frame classes and their fixed plaintext sizes:
//   control frames (text, typing, spent, burn, key offers, file meta)
//     → CONTROL_FRAME_BYTES (20480). Chosen because the composer allows
//       4000 characters, which is up to 16 KB of UTF-8; 4096 could not
//       contain the product's own maximum message. Uniformity is the
//       property; the size must simply dominate every control payload.
//   file chunk frames → FILE_FRAME_BYTES (65536). A file is padded to
//     the smallest SIZE BUCKET that holds it and split into that
//     bucket's number of chunks. The relay therefore learns the
//     bucket, not the file's true size, and a 1 KB note costs about
//     64 KB of traffic instead of the 4 MB a fixed payload used to
//     cost. The trade is honest: the number of frames says which
//     bucket the file is in.
//
// Replay defense lives here too: every frame body carries a per-sender
// monotonic counter inside a per-session tag, a timestamp checked
// against a ±10 minute window, and a unique frame id.

import {
  signCanonical,
  verifyCanonical,
  sha256HexOfBytes,
  toB64,
  fromB64,
} from "./crypto";
import { type ReplySnapshot } from "./types";

export { toB64, fromB64 };
export type { ReplySnapshot };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------- constants ---------------- */

export const CONTROL_FRAME_BYTES = 20480;
export const FILE_FRAME_BYTES = 65536;
/** base64 characters of file payload carried per chunk frame */
export const FILE_CHUNK_B64 = 64000;

/** File size buckets, smallest first. A file is padded to the
 *  smallest bucket that holds it, so the wire cost is a step
 *  function: 64 KB, 256 KB, 1 MB, 2 MB. Before the buckets, every
 *  file was padded to the largest one and split into the same 44
 *  chunks, so a 1 KB voice note cost about 4 MB of traffic. */
export const FILE_BUCKETS = [64 * 1024, 256 * 1024, 1024 * 1024, 2 * 1024 * 1024].map(
  (bytes) => ({ bytes, b64: Math.ceil(bytes / 3) * 4 }),
);

/** The bucket a file of this size is padded to. A file bigger than
 *  the largest bucket is refused by the size check; the caller never
 *  gets here with one. */
export function fileBucketFor(size: number): { bytes: number; b64: number } {
  for (const bucket of FILE_BUCKETS) {
    if (size <= bucket.bytes) return bucket;
  }
  return FILE_BUCKETS[FILE_BUCKETS.length - 1];
}

/** How many chunk frames a bucket is split into. */
export function fileChunksFor(bucketB64: number): number {
  return Math.ceil(bucketB64 / FILE_CHUNK_B64);
}

/** The chunk counts a receiver accepts: one per bucket. */
export const FILE_TOTALS = FILE_BUCKETS.map((b) => fileChunksFor(b.b64));

/** The largest file the wire format can carry, in bytes: the largest
 *  bucket. A file meta claiming more than this is refused. */
export const FILE_MAX_BYTES = FILE_BUCKETS[FILE_BUCKETS.length - 1].bytes;

/** Frame version this build seals with. Reads accept this version only:
 *  a v2 frame is dropped, because v2's signing string cannot tell two
 *  different bodies apart. */
export const WIRE_VERSION = 3;

export const TS_WINDOW_MS = 10 * 60 * 1000;
export const KEY_GRACE_MS = 30_000;

/** A key version is a pair: the rotation epoch it belongs to, and a
 *  random offset inside that epoch. The pair compares as one number,
 *  so a version from a later epoch always wins, and two rotations
 *  inside one epoch land on two different numbers instead of both
 *  installing a different key under the same one. */
export const ROTATION_VERSION_SPAN = 2 ** 32;

/** The version number for a rotation in this epoch, at this offset. */
export function rotationVersion(epoch: number, offset: number): number {
  return epoch * ROTATION_VERSION_SPAN + offset;
}

/** The epoch a version belongs to. */
export function rotationEpochOf(version: number): number {
  return Math.floor(version / ROTATION_VERSION_SPAN);
}
export const PENDING_TTL_MS = 5_000;
export const PENDING_MAX = 64;

/* ---------------- wire + body types ---------------- */

export type FrameKind =
  | "text"
  | "typing"
  | "spent"
  | "burn"
  | "cover"
  | "key:offer"
  | "file:meta"
  | "file:chunk"
  | "react";

export interface OfferBody {
  to: string;
  /** the key version this offer installs */
  kv: number;
  /** rotation offer (from the coordinator) vs join delivery */
  rot: boolean;
  /** sender's session ECDH public key; must match the registry (UKS defense) */
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
  /** quoted-reply target snapshot: signature-covered via the
   *  canonical (see replyCanonical), so a quote is exactly as
   *  unforgeable as the message that carries it */
  reply?: ReplySnapshot;
  chunk?: { messageId: string; seq: number; total: number; dataB64: string };
}

export interface WireFrame {
  v: 3;
  roomId: string;
  /** key version this frame is encrypted under. 0 = encrypted under the
   *  password-derived ENTRY key (key-delivery offers), readable by
   *  any password holder at any time; the secret inside is still
   *  ECDH-wrapped pairwise. */
  kv: number;
  from: string;
  id: string;
  /** frame issue time, in the clear; lets receivers expire stale
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

/** Inverse of padToSize. Never throws: the GCM tag is the integrity
 *  check; a bogus length prefix just yields garbage bytes. */
export function unpadFromSize(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4) return new Uint8Array(0);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = dv.getUint32(0, true);
  if (len > bytes.length - 4) return new Uint8Array(0);
  return bytes.subarray(4, 4 + len);
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Random base64 filler; never decoded, exists only for uniform length.
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
 *  not reset the defense. Both internal maps are bounded: ids at
 *  `idCapacity`, counter watermarks at `maxTrackers` (long-lived rooms
 *  otherwise accumulate one map entry per (sender, session-tag) —
 *  every page load of every member — for the room's lifetime). */
export function createReplayGuard(opts?: {
  now?: () => number;
  idCapacity?: number;
  maxTrackers?: number;
  initialHigh?: Map<string, number>;
  onAccept?: (key: string, counter: number) => void;
}): ReplayGuard {
  const now = opts?.now ?? Date.now;
  const capacity = opts?.idCapacity ?? 2048;
  const maxTrackers = opts?.maxTrackers ?? 2048;
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
      if (!highest.has(key) && highest.size >= maxTrackers) {
        // FIFO evict the oldest insertion order entry (stale session).
        const drop = highest.keys().next().value;
        if (drop !== undefined) highest.delete(drop);
      }
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

/** Deterministic serialisation of a reply snapshot for the canonical
 *  string. Encryption and verification both build it through this one
 *  function, so whatever a sender signed is exactly what a receiver
 *  re-computes: a tampered quote breaks the signature. The unit
 *  separator is cosmetic; slot order is what binds. */
export function replyCanonical(
  r?: { id: string; senderId: string; snippet: string; file?: boolean },
): string {
  if (
    !r ||
    typeof r.id !== "string" ||
    typeof r.senderId !== "string" ||
    typeof r.snippet !== "string"
  ) {
    return "";
  }
  return `${r.id}\u001f${r.senderId}\u001f${r.snippet}\u001f${r.file ? "1" : "0"}`;
}

/** Percent-escape the three characters that are structural in the
 * canonical string: the field separator "|", the reply-slot separator
 * \u001f, and the escape character "%" itself (escaped first, so the
 * encoding is injective: "%7C" produced by the escaper can never be
 * confused with a literal "%7C" from the field, which becomes "%257C").
 *
 * A no-op for every value this field has ever legitimately held
 * (messageIds are crypto.randomUUID()s; key:offer ids are
 * "offer:{cuid}:{epoch}", and cuids are [a-z0-9]), which is what
 * keeps the Round-31 cross-version proofs byte-identical: real plain
 * letters still canonicalise to the exact pre-reply eleven-field
 * string, so old tabs and new tabs keep verifying each other's plain
 * letters.
 *
 * Why only field 11: the conditional 12th slot created a NEW ambiguity
 * class at the 11→12 boundary. Before this escape, a plain frame whose
 * messageId was crafted as "abc|<replyCanonical>" produced the SAME
 * string as the reply frame {messageId:"abc", reply}, so a signed
 * plain frame could be re-encrypted as a quote-carrying frame its
 * author
 * never wrote. After the escape, field 11 contains no "|", so no plain
 * frame's tail can ever equal `messageId + "|" + replySlot` (the
 * right-hand side always contains the joiner). The residual ambiguity
 * *within* earlier variable-length fields (e.g. text containing "|")
 * predates replies and is blocked by the Task-19.1 replay window: any
 * canonical-collision forgery must reuse the victim's exact
 * (senderId, sessionTag, counter, ts) clock, which the window rejects.
 */
export function escapeCanonicalField(s: string): string {
  return s.replace(/%/g, "%25").replace(/\|/g, "%7C").replace(/\u001f/g, "%1f");
}

/** The v2 signing string. LEGACY. Nothing in the running product
 *  builds or verifies this any more.
 *
 *  It is kept in the tree for one reason: the regression test that
 *  says why v2 frames are refused. v2 joined variable-length fields
 *  with "|" and escaped only `messageId`, so `{text:"hello|world",
 *  fileSha:""}` and `{text:"hello", fileSha:"world|"}` produced the
 *  same string. The escaping fixed one boundary and left the rest of
 *  the fields raw, which is the bug. Do not build new frames with it,
 *  and do not verify frames with it: a v2 frame is refused at the
 *  door. */
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
  reply?: ReplySnapshot;
}): string {
  const base = [
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
    escapeCanonicalField(f.messageId ?? ""),
  ].join("|");
  // The reply slot is appended ONLY when a quote exists, so a plain
  // frame's canonical is byte-identical to the pre-reply eleven-field
  // form. That is the rollout proof: a tab running old code verifies
  // new plain letters, and a new tab verifies old ones; only a letter
  // that actually carries a quote needs both ends current (an old tab
  // drops it rather than accept a quote it cannot check). A valid
  // snapshot never serialises to "" (it has content and separators),
  // so "no reply" and "reply that failed the shape guard" are the
  // same string, and a tampered reply changes the canonical, which
  // is exactly what breaks the signature.
  const reply = replyCanonical(f.reply);
  return reply ? `${base}|${reply}` : base;
}

/* ---------------- canonical v3 ---------------- */

/* v3 fixes two bugs at once.

B1: v2 concatenated variable-length fields with "|" and escaped only
`messageId`, so `{text:"hello|world", fileSha:""}` and
`{text:"hello", fileSha:"world|"}` signed the same string, and a
signature made for one verified for the other.

B2: v2 signed only the text and the top level file sha. The ttl, the
view-once flag, the file name and mime, the file bytes and the key
offer contents all travelled unsigned, so a member holding the room
key could rewrite them and the sender's signature still verified.

v3 fixes both by signing the body as a whole:

    "<len>:v3" + "<len>:<roomId>" + "<len>:<sha256 of the body>"

The body is serialised canonically (object keys sorted, undefined
dropped, numbers formatted the way JSON formats them) and then hashed.
Every field the body carries sits inside that hash, including fields
nobody had thought about when the protocol was written. The outer
fields are length-prefixed, so no two different (room, body) pairs can
produce the same string.

Length prefixing means there is nothing to escape, and therefore
nothing to forget to escape. The length is a UTF-8 byte count so a
value holding astral characters counts the same on both sides. */

/** One canonical field: "<utf8 byte count>:<value>". */
function fieldV3(s: string): string {
  return `${encoder.encode(s).length}:${s}`;
}

/** Deterministic JSON. Object keys sorted, undefined dropped, arrays
 *  keep their order, numbers formatted exactly the way JSON formats
 *  them. Both ends build it from the same values, so the bytes match. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  const t = typeof value;
  if (t === "number") {
    const n = value as number;
    return Number.isFinite(n) ? String(n) : "null";
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t !== "object") return "null"; // undefined, function, symbol
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** The canonical string for a frame body.
 *
 *  The body minus its own signature is serialised canonically and
 *  hashed, so the signature covers every field the body carries. The
 *  sealer and the verifier both call this one function with the same
 *  body, so the two sides cannot drift apart.
 *
 *  The two outer fields are length-prefixed, so no two different
 *  (room, body) pairs produce the same string. */
export async function canonicalV3FromBody(roomId: string, body: unknown): Promise<string> {
  const { sig: _sig, ...rest } = (body ?? {}) as Record<string, unknown>;
  const hash = await sha256HexOfBytes(encoder.encode(canonicalJson(rest)));
  return fieldV3("v3") + fieldV3(roomId) + fieldV3(hash);
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
  /** signing half: JWK (tests, extractable flows) or a non-extractable
   *  CryptoKey (the vault path). Present when the frame should carry a
   *  signature inside its encrypted body. */
  sigPrivJwk?: JsonWebKey | CryptoKey;
}): Promise<WireFrame> {
  const counter = opts.clock.next();
  const ts = Date.now();
  const kind = String(opts.body.kind ?? "");

  // The body as it goes on the wire, before the signature goes in.
  // The canonical is computed from THIS object, so the verifier, which
  // reads the same object back out of the ciphertext, rebuilds the
  // same string.
  const preSeal: FrameBody = {
    ...(opts.body as object),
    kind: kind as FrameKind,
    senderId: opts.senderId,
    sessionTag: opts.clock.sessionTag,
    counter,
    ts,
    kv: opts.kv,
    sig: "",
  };

  // v3 canonical: the whole body, hashed, under a length-prefixed
  // room id. Every field the body carries is inside the signature.
  const canonical = await canonicalV3FromBody(opts.roomId, preSeal);
  const sig = opts.sigPrivJwk ? await signCanonical(opts.sigPrivJwk, canonical) : "";

  const sealed: FrameBody = { ...preSeal, sig };

  const padded = padToSize(encoder.encode(JSON.stringify(sealed)), opts.frameSize);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    opts.key,
    padded as unknown as BufferSource,
  );
  return {
    v: WIRE_VERSION,
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

/** Ephemeral ECDH P-256 pair, regenerated on every page load, held
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
