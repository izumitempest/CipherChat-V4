// RoomCipher: the per-room security engine. One instance per joined
// room, memory only. It owns:
//
//   the key ring         versioned room keys (v1 = password-derived
//                        entry key; later versions = random keys
//                        delivered over ECDH; old versions kept for a
//                        short decrypt-only grace window)
//   the member registry  frames only flow between current members;
//                        a departed member is evicted here first
//   the replay guard     counters / timestamps / frame ids
//   the file assembler   fixed-count chunk frames back into bytes
//
// The UI store is a thin adapter around this class; every security
// decision lives here, where the Task 19 tests can reach it.

import {
  CONTROL_FRAME_BYTES,
  FILE_CHUNK_B64,
  FILE_FRAME_BYTES,
  FILE_MAX_BYTES,
  FILE_TOTALS,
  fileBucketFor,
  fileChunksFor,
  KEY_GRACE_MS,
  PENDING_MAX,
  PENDING_TTL_MS,
  ROTATION_VERSION_SPAN,
  WIRE_VERSION,
  canonicalV3FromBody,
  createReplayGuard,
  createSendClock,
  ecdhUnwrapKey,
  ecdhWrapKey,
  generateSessionEcdh,
  importAesKey,
  openFrame,
  padB64Payload,
  rotationEpochOf,
  sealFrame,
  type FileMetaBody,
  type FrameBody,
  type OfferBody,
  type ReplayGuard,
  type SendClock,
  type SessionEcdh,
  type WireFrame,
} from "./protocol";
import {
  burnCanonical,
  decryptJson,
  encryptJson,
  fromB64,
  sha256HexOfBytes,
  signCanonical,
  toB64,
  verifyCanonical,
} from "./crypto";
import { signLeaveProof } from "./leave-proof";
import { isReactionMark, isReplySnapshot, type ReplySnapshot } from "./types";

export interface RegistryEntry {
  pubkey: JsonWebKey;
  ecdhPubB64?: string;
  connected?: boolean;
  joinedAt?: number;
  alias?: string;
  colorIdx?: number;
}

export interface CipherInit {
  roomId: string;
  selfId: string;
  /** The room's signing half. `priv` is a non-extractable CryptoKey in
   *  the live app (vault path); tests and extractable flows pass a
   *  JWK. The public half is always a JWK because it is published to
   *  the room's member registry. */
  sig: { priv: JsonWebKey | CryptoKey; pubJwk: JsonWebKey };
  ecdh: SessionEcdh;
  /** the kv-1 password-derived key (from the room's key bundle) */
  entryKey: CryptoKey;
  now?: () => number;
  graceMs?: number;
  /** optional persistence for replay watermarks; survives refresh */
  watermarks?: WatermarkStore;
  /** the pending file-transfer byte budget, in base64 characters.
   *  Lowered in tests so the ceiling can be reached without moving
   *  sixteen megabytes. */
  pendingFileByteBudget?: number;
  /** where the rotation version offset comes from. Injectable, so
   *  the version policy can be tested without luck. */
  randomOffset?: () => number;
}

/** Persists per-(sender, session) counter watermarks so a page refresh
 *  does not reset the replay defense. Injected by the store (localStorage
 *  in the browser); pure in tests. */
export interface WatermarkStore {
  load(): Record<string, number>;
  save(data: Record<string, number>): void;
}

export type OpenResult =
  | { type: "text"; body: FrameBody }
  | { type: "typing"; senderId: string }
  | { type: "spent"; messageId: string; senderId: string }
  | { type: "burn"; messageId: string; senderId: string }
  | { type: "react"; messageId: string; senderId: string; mark: string }
  | { type: "cover" } // accepted, replay-guarded, and discarded: no UI state
  | { type: "file-meta"; senderId: string }
  | { type: "file-chunk"; senderId: string }
  | {
      type: "file";
      senderId: string;
      ts: number;
      /** caption typed alongside the attachment; travels in the meta frame's
       * canonical-signed top-level text field, so it is nameplate-authentic */
      text?: string;
      /** quoted-reply target; signature-covered like the caption */
      reply?: ReplySnapshot;
      file: FileMetaBody & { dataB64: string };
    }
  | { type: "offer-installed"; kv: number; rotation: boolean }
  | { type: "pending" }
  | {
      type: "reject";
      reason:
        | "shape"
        | "registry"
        | "kv"
        | "decrypt"
        | "signature"
        | "replay"
        | "offer"
        | "sha";
    };

/** Hard ceiling for key versions, counted in EPOCHS. A version is an
 *  epoch and an offset inside it, so the cap applies to the epoch
 *  part: offers claiming an epoch beyond this are rejected. A hostile
 *  member could otherwise install a version so high that every future
 *  rotation lands below it and the room can never rotate again. */
export const KVERSION_CAP = 1_000_000;

interface InstalledKey {
  key: CryptoKey;
  raw: Uint8Array; // empty for the entry key (non-extractable)
  installedAt: number;
}

interface AssemblingFile {
  meta: FileMetaBody;
  /** the signature-covered caption (top-level frame text) */
  text?: string;
  /** the signature-covered quote snapshot, when the file replies */
  reply?: ReplySnapshot;
  metaTs: number;
  chunks: Map<number, string>;
  /** how many base64 characters this transfer is holding, so the
   *  pending byte budget can be kept honest */
  bytes: number;
}

/** How many file transfers may be in flight at once. Each one holds
 *  chunk strings, so this is a memory ceiling as much as a politeness
 *  one. */
const MAX_PENDING_FILES = 32;

/** The file meta has to be sane before it is stored. The size decides
 *  how much of the assembled payload is the file, the name and the
 *  mime are rendered, and the sha is compared against the bytes later.
 *  A signed meta can still be nonsense: the sender is authenticated,
 *  not trusted. */
function isSaneFileMeta(file: FileMetaBody): boolean {
  if (typeof file.messageId !== "string" || file.messageId.length === 0) return false;
  if (typeof file.name !== "string" || file.name.length > 256) return false;
  if (typeof file.mime !== "string" || file.mime.length > 128) return false;
  if (!Number.isInteger(file.size) || file.size < 0 || file.size > FILE_MAX_BYTES) return false;
  if (typeof file.sha !== "string" || !/^[0-9a-f]{64}$/.test(file.sha)) return false;
  if (file.ttlSec !== undefined && (!Number.isFinite(file.ttlSec) || file.ttlSec < 0)) {
    return false;
  }
  if (file.viewOnce !== undefined && typeof file.viewOnce !== "boolean") return false;
  return true;
}

/** The pending byte budget for file transfers, in base64 characters.
 *  A full file is 2.8M characters, so this holds a handful of files
 *  and refuses a flood. */
const MAX_PENDING_BYTES = 16 * 1024 * 1024;

export class RoomCipher {
  readonly roomId: string;
  readonly selfId: string;
  readonly sigPubJwk: JsonWebKey;
  readonly ecdh: SessionEcdh;
  readonly registry = new Map<string, RegistryEntry>();
  kv = 1;

  private readonly sigPriv: JsonWebKey | CryptoKey;
  private readonly entryKey: CryptoKey;
  private readonly keys = new Map<number, InstalledKey>();
  private readonly clock: SendClock = createSendClock();
  private readonly replay: ReplayGuard;
  private readonly now: () => number;
  private readonly graceMs: number;
  private pending: { frame: WireFrame; at: number }[] = [];
  private readyQueue: WireFrame[] = [];
  private readonly files = new Map<string, AssemblingFile>();
  /** base64 characters held by the pending file transfers */
  private pendingFileBytes = 0;
  /** the ceiling for those characters */
  private readonly pendingByteBudget: number;
  /** the source of the rotation version offset */
  private readonly offsetSource: () => number;
  private readonly highWater: Record<string, number> = {};
  private readonly watermarks?: WatermarkStore;

  constructor(init: CipherInit) {
    this.roomId = init.roomId;
    this.selfId = init.selfId;
    this.sigPriv = init.sig.priv;
    this.sigPubJwk = init.sig.pubJwk;
    this.ecdh = init.ecdh;
    this.entryKey = init.entryKey;
    this.now = init.now ?? Date.now;
    this.graceMs = init.graceMs ?? KEY_GRACE_MS;
    this.pendingByteBudget = init.pendingFileByteBudget ?? MAX_PENDING_BYTES;
    this.offsetSource =
      init.randomOffset ??
      (() => crypto.getRandomValues(new Uint32Array(1))[0] as number);
    this.watermarks = init.watermarks;
    this.keys.set(1, { key: init.entryKey, raw: new Uint8Array(0), installedAt: this.now() });
    if (init.watermarks) {
      try {
        this.highWater = init.watermarks.load() ?? {};
      } catch {
        this.highWater = {};
      }
    }
    const initial = new Map<string, number>(
      Object.entries(this.highWater).map(([k, v]) => [k, Number(v)]),
    );
    this.replay = createReplayGuard({
      initialHigh: initial,
      onAccept: (key, counter) => {
        this.highWater[key] = counter;
        this.persistWatermarks();
      },
    });
  }

  private persistWatermarks() {
    if (!this.watermarks) return;
    const entries = Object.entries(this.highWater);
    // Bounded: keep the most recent 512 (sender, session) watermarks.
    const trimmed = entries.length > 512 ? entries.slice(entries.length - 512) : entries;
    try {
      this.watermarks.save(Object.fromEntries(trimmed));
    } catch {
      /* storage full/unavailable; defense degrades to per-page-load */
    }
  }

  /* ---------------- key ring ---------------- */

  getKey(kv: number): CryptoKey | undefined {
    this.pruneGrace();
    return this.keys.get(kv)?.key;
  }

  /** Install a newer key version. Old versions stay decryptable for the
   *  grace window, then are refused. Returns frames that were parked
   *  pending this key (the caller should drain them). */
  installKey(
    kv: number,
    key: CryptoKey,
    opts?: { rotation?: boolean; raw?: Uint8Array },
  ): WireFrame[] {
    if (
      kv <= this.kv ||
      !Number.isSafeInteger(kv) ||
      rotationEpochOf(kv) > KVERSION_CAP
    ) {
      return [];
    }
    this.keys.set(kv, {
      key,
      raw: opts?.raw ?? new Uint8Array(0),
      installedAt: this.now(),
    });
    this.kv = kv;
    const ready = this.pending.filter((p) => p.frame.kv <= kv).map((p) => p.frame);
    this.pending = this.pending.filter((p) => p.frame.kv > kv);
    this.readyQueue.push(...ready);
    return ready;
  }

  /** Frames that became processable after a key install, paired with
   *  their open results (the pair carries the frame id, the message id). */
  async drainPending(): Promise<{ frame: WireFrame; result: OpenResult }[]> {
    const out: { frame: WireFrame; result: OpenResult }[] = [];
    let guard = 0;
    while (this.readyQueue.length && guard++ < 128) {
      const frame = this.readyQueue.shift()!;
      out.push({ frame, result: await this.open(frame) });
    }
    return out;
  }

  /** The entry key (kv 1): permanent, used to wrap join deliveries. */
  getEntryKey(): CryptoKey {
    return this.entryKey;
  }

  private pruneGrace() {
    const t = this.now();
    for (const [kv, inst] of this.keys) {
      if (kv !== this.kv && t - inst.installedAt > this.graceMs) {
        this.keys.delete(kv);
      }
    }
  }

  private requireKey(kv: number): CryptoKey {
    const key = this.keys.get(kv)?.key;
    if (!key) throw new Error(`no key installed for version ${kv}`);
    return key;
  }

  /* ---------------- coordinator ---------------- */

  /** Deterministic coordinator: the lowest memberId among connected
   *  members (excluding the given ids, e.g. the leaver). Every client
   *  computes the same answer from the same registry. */
  expectedCoordinator(exclude: string[] = []): string | null {
    const ids = [...this.registry.keys()].filter(
      (id) => !exclude.includes(id) && this.registry.get(id)?.connected !== false,
    );
    if (!ids.length) return null;
    ids.sort();
    return ids[0];
  }

  /* ---------------- sealing ---------------- */

  private async seal(
    body: Record<string, unknown>,
    frameSize: number,
    extra?: { frameId?: string; to?: string; wireKey?: CryptoKey; wireKv?: number },
  ): Promise<WireFrame> {
    return sealFrame({
      key: extra?.wireKey ?? this.requireKey(this.kv),
      roomId: this.roomId,
      kv: extra?.wireKv ?? this.kv,
      senderId: this.selfId,
      clock: this.clock,
      sigPrivJwk: this.sigPriv,
      body,
      frameSize,
      frameId: extra?.frameId,
      to: extra?.to,
    });
  }

  async sealText(opts: {
    text: string;
    ttlSec?: number;
    reply?: ReplySnapshot;
  }): Promise<WireFrame[]> {
    return [
      await this.seal(
        { kind: "text", text: opts.text, ttlSec: opts.ttlSec, reply: opts.reply },
        CONTROL_FRAME_BYTES,
      ),
    ];
  }

  async sealTyping(): Promise<WireFrame[]> {
    return [await this.seal({ kind: "typing", typing: true }, CONTROL_FRAME_BYTES)];
  }

  /** A dummy frame under the same AES-GCM envelope as every other
   *  control frame (byte-identical size, same key schedule). Sent on a
   *  steady cadence when cover traffic is enabled for the room, so the
   *  wire carries a constant-rate stream whether or not anyone is
   *  typing. The payload carries nothing; receivers drop it on open.
   *  The sender's replay clock advances normally, so covers never
   *  collide with real traffic from the same member. */
  async sealCover(): Promise<WireFrame[]> {
    return [await this.seal({ kind: "cover" }, CONTROL_FRAME_BYTES)];
  }

  /** Key age at which the coordinator re-derives the room key
   *  (time-based rotation, round 33). Rotations also happen on leave
   *  and on eviction; this timer covers the case where nobody leaves
   *  for a very long room (a key that never rotates eventually becomes
   *  a static target). Members install the new key when it arrives;
   *  only the coordinator seals it, so two coordinators never clash. */
  static readonly ROTATION_AGE_MS = 60 * 60_000; // one hour per key

  /** Should the current key be considered stale for the purposes of
   *  time-based rotation? Pure so tests can drive `now`. Callers must
   *  also check `expectedCoordinator() === selfId` before sealing;
   *  only the coordinator rotates. */
  currentKeyStaleAt(now: number): boolean {
    const inst = this.keys.get(this.kv);
    if (!inst) return true; // no key = overdue, coordinator will rotate
    return now - inst.installedAt >= RoomCipher.ROTATION_AGE_MS;
  }

  async sealSpent(messageId: string): Promise<WireFrame[]> {
    return [await this.seal({ kind: "spent", messageId }, CONTROL_FRAME_BYTES)];
  }

  /** An ink margin mark on a message. The mark glyph travels in the
   *  canonical-signed `text` field and the target in `messageId`:
   *  both are signature-covered, so a mark is exactly as unforgeable
   *  as the words it annotates. */
  async sealReact(messageId: string, mark: string): Promise<WireFrame[]> {
    return [await this.seal({ kind: "react", messageId, text: mark }, CONTROL_FRAME_BYTES)];
  }

  /** Early burn of one of our own messages. Signed with the burn
   *  canonical, so nobody else can burn our messages. */
  async sealBurn(messageId: string): Promise<WireFrame[]> {
    const burnSig = await signCanonical(
      this.sigPriv,
      burnCanonical(this.roomId, this.selfId, messageId),
    );
    return [await this.seal({ kind: "burn", messageId, burnSig }, CONTROL_FRAME_BYTES)];
  }

  /** Proof-of-possession for a clean departure: signs the canonical
   *  leave string with this room's signing key, so the server can
   *  verify against the registered pubkey before writing us out:
   *  memberId alone must never be enough to rotate the room. */
  async signDepartureProof(ts: number = Date.now()) {
    return signLeaveProof(this.sigPriv, this.roomId, this.selfId, ts);
  }

  /** A file becomes exactly 1 control-sized meta frame plus a FIXED
   *  number of uniform chunk frames, regardless of true file size. */
  async sealFile(opts: {
    name: string;
    mime: string;
    size: number;
    dataB64: string;
    sha: string;
    /** caption typed alongside the attachment */
    text?: string;
    ttlSec?: number;
    viewOnce?: boolean;
    /** quoted-reply target; rides the meta frame, signature-covered */
    reply?: ReplySnapshot;
  }): Promise<WireFrame[]> {
    // The bucket: the smallest one that holds the file. The padding
    // hides the true size inside the bucket, and the bucket decides
    // how many frames the file costs.
    const bucket = fileBucketFor(opts.size);
    const padded = padB64Payload(opts.dataB64, bucket.b64);
    const total = fileChunksFor(bucket.b64);
    const messageId = crypto.randomUUID();
    const meta = await this.seal(
      {
        kind: "file:meta",
        messageId,
        // Top-level text is part of canonicalV2: the caption is signed,
        // so it holds the same signature guarantee as the sender's words
        // in text frames.
        text: opts.text,
        reply: opts.reply,
        file: {
          messageId,
          name: opts.name,
          mime: opts.mime,
          size: opts.size,
          sha: opts.sha,
          ttlSec: opts.ttlSec,
          viewOnce: opts.viewOnce,
        },
      },
      CONTROL_FRAME_BYTES,
      { frameId: messageId },
    );
    const frames: WireFrame[] = [meta];
    for (let seq = 0; seq < total; seq++) {
      const dataB64 = padded.slice(seq * FILE_CHUNK_B64, (seq + 1) * FILE_CHUNK_B64);
      frames.push(
        await this.seal(
          { kind: "file:chunk", chunk: { messageId, seq, total, dataB64 } },
          FILE_FRAME_BYTES,
        ),
      );
    }
    return frames;
  }

  /** Wrap a room key for one recipient over ECDH. Rotation offers ride
   *  in a frame encrypted under the OLD key (recipients can still open
   *  it); join deliveries ride in a frame encrypted under the ENTRY key
   *  (only a joiner who proved the password can open it) and carry a
   *  second, entry-key layer around the ECDH wrap. */
  async sealKeyOffer(opts: {
    to: string;
    kv: number;
    keyRaw: Uint8Array;
    rot: boolean;
    outerKey?: CryptoKey;
    wireKey?: CryptoKey;
    wireKv?: number;
    overrideEcdh?: SessionEcdh;
  }): Promise<WireFrame[]> {
    const ecdhUse = opts.overrideEcdh ?? this.ecdh;
    const theirPub = this.registry.get(opts.to)?.ecdhPubB64;
    if (!theirPub) return []; // nothing we can do for a member without a session key
    const { wrapIv, wrapCt } = await ecdhWrapKey({
      myPrivJwk: ecdhUse.privJwk,
      theirPubRawB64: theirPub,
      roomId: this.roomId,
      kv: opts.kv,
      payload: { keyB64: toB64(opts.keyRaw), kv: opts.kv, rot: opts.rot, issuedAt: this.now() },
    });
    let offer: OfferBody = {
      to: opts.to,
      kv: opts.kv,
      rot: opts.rot,
      ecdhPubB64: ecdhUse.pubRawB64,
      wrapIv,
      wrapCt,
    };
    if (opts.outerKey) {
      const outer = await encryptJson(opts.outerKey, {
        ecdhPubB64: ecdhUse.pubRawB64,
        wrapIv,
        wrapCt,
      });
      offer = { to: opts.to, kv: opts.kv, rot: opts.rot, outerIv: outer.iv, outerCt: outer.ct };
    }
    return [
      await this.seal(
        { kind: "key:offer", messageId: `offer:${opts.to}:${opts.kv}`, offer },
        CONTROL_FRAME_BYTES,
        {
          to: opts.to,
          wireKey: opts.wireKey ?? (opts.outerKey ? this.entryKey : undefined),
          wireKv: opts.wireKv ?? (opts.outerKey || opts.rot ? 0 : undefined),
        },
      ),
    ];
  }

  /** Rotate unconditionally: generate a RANDOM new room key and
   *  deliver it pairwise over ECDH. Callers decide whether they have
   *  the right to rotate (see rotateAsCoordinator / the rejoin
   *  fallback in the store).
   *
   *  `serverEpoch` is the server's rotation ledger, the shared lower
   *  bound on the versions the room has used. The new version is that
   *  epoch plus a fresh random offset, so two members rotating at the
   *  same time land on two different versions and one of them wins,
   *  instead of both installing a different key under the same number
   *  and reading nothing of each other afterwards.
   *
   *  `rot` marks the offer as the formal leave-ceremony (receivers
   *  verify the sender is their coordinator). Fallback re-keys use
   *  rot=false: a member-initiated delivery, still ECDH-wrapped,
   *  signature-checked, registry-gated and version-monotonic. */
  async rotateTo(serverEpoch = 0, rot = true): Promise<WireFrame[]> {
    const newKv = this.nextVersion(serverEpoch);
    const keyRaw = crypto.getRandomValues(new Uint8Array(32));
    const key = await importAesKey(keyRaw);
    this.keys.set(newKv, { key, raw: keyRaw, installedAt: this.now() });
    this.kv = newKv;

    const frames: WireFrame[] = [];
    for (const [id, entry] of this.registry) {
      if (id === this.selfId || !entry.ecdhPubB64) continue;
      frames.push(
        ...(await this.sealKeyOffer({
          to: id,
          kv: newKv,
          keyRaw,
          rot,
          wireKey: this.entryKey,
          wireKv: 0,
        })),
      );
    }
    return frames;
  }

  /** Rotate IF this client is the deterministic coordinator (the
   *  normal ceremony after a member leaves).
   *
   *  `serverEpoch` is the server's rotation ledger (room epoch): a
   *  member re-joining after a refresh may have lost count of
   *  rotations, and a departed member may hold keys up to that epoch,
   *  so the new version has to sit in a later one. Offers are
   *  encrypted under the ENTRY key so every member can read them no
   *  matter which version they hold. */
  async rotateAsCoordinator(serverEpoch = 0): Promise<WireFrame[]> {
    if (this.expectedCoordinator() !== this.selfId) return [];
    return this.rotateTo(serverEpoch);
  }

  /** The next key version for a rotation.
   *
   *  A version is an epoch and an offset inside it. The epoch is the
   *  server's rotation ledger, or this client's own epoch when that
   *  is further ahead. The offset is fresh, so two rotations in one
   *  epoch land on two different versions. The offset also has to
   *  clear this client's own offset in that epoch, or the new
   *  version would not be greater than the one already held. */
  private nextVersion(serverEpoch: number): number {
    const epoch = Math.max(rotationEpochOf(this.kv), Math.floor(serverEpoch));
    const base = epoch * ROTATION_VERSION_SPAN;
    const minOffset = this.kv - base;
    let offset = this.randomOffset();
    for (let i = 0; i < 8 && offset <= minOffset; i++) offset = this.randomOffset();
    if (offset <= minOffset) {
      // This client's offset sits at the top of the epoch. Take the
      // next epoch rather than draw again.
      return (epoch + 1) * ROTATION_VERSION_SPAN;
    }
    return base + offset;
  }

  /** A fresh offset inside a rotation epoch. Injectable, so the
   *  version policy can be tested without luck. */
  private randomOffset(): number {
    return this.offsetSource();
  }

  /** Deliver the CURRENT room key to a new member: ECDH-wrapped and
   *  additionally encrypted under the entry key, so only a joiner who
   *  derived the same password can open it. No-op while the room is
   *  still on its password-derived key (joiners derive that themselves). */
  async deliverKeyTo(memberId: string): Promise<WireFrame[]> {
    if (this.kv <= 1) return [];
    const inst = this.keys.get(this.kv);
    if (!inst || !inst.raw.length) return [];
    return this.sealKeyOffer({
      to: memberId,
      kv: this.kv,
      keyRaw: inst.raw,
      rot: false,
      outerKey: this.entryKey,
    });
  }

  /* ---------------- opening ---------------- */

  async open(frame: WireFrame): Promise<OpenResult> {
    if (
      !frame ||
      // v3 only. A v2 frame is dropped here rather than verified
      // under the old canonical, because that canonical cannot tell
      // two different bodies apart. An old tab and a new tab simply do
      // not hear each other.
      frame.v !== WIRE_VERSION ||
      typeof frame.ct !== "string" ||
      typeof frame.iv !== "string" ||
      typeof frame.from !== "string"
    ) {
      return { type: "reject", reason: "shape" };
    }
    // A frame addressed to another room never gets here, but say so
    // out loud rather than relying on the key to fail.
    if (frame.roomId !== this.roomId) {
      return { type: "reject", reason: "shape" };
    }
    // Addressed to someone else (the relay broadcasts everything).
    if (frame.to && frame.to !== this.selfId) {
      return { type: "reject", reason: "offer" };
    }
    // Eviction gate: frames only flow between CURRENT members.
    const entry = this.registry.get(frame.from);
    if (!entry) {
      return { type: "reject", reason: "registry" };
    }

    // Key selection.
    this.pruneGrace();
    let key: CryptoKey | undefined;
    if (frame.kv === 0) {
      // Entry-key-encrypted frame (key-delivery offer): the entry key
      // is permanent, so these stay readable at any key version. The
      // secret inside is still wrapped pairwise over ECDH.
      key = this.entryKey;
    } else if (frame.kv === this.kv) {
      key = this.keys.get(frame.kv)?.key;
      if (!key) return { type: "reject", reason: "kv" };
    } else if (frame.kv > this.kv) {
      // Newer key version: either a rotation is in flight (we are one
      // offer behind) or we are a joiner awaiting delivery. Hold fresh
      // frames briefly; expire stale pending frames; refuse anything
      // stale.
      const t = this.now();
      this.pending = this.pending.filter((p) => t - p.at <= PENDING_TTL_MS);
      if (t - (frame.ts ?? 0) <= PENDING_TTL_MS && this.pending.length < PENDING_MAX) {
        this.pending.push({ frame, at: t });
        return { type: "pending" };
      }
      return { type: "reject", reason: "kv" };
    } else {
      key = this.keys.get(frame.kv)?.key; // grace window for old versions
      if (!key) return { type: "reject", reason: "kv" };
    }

    const body = await openFrame(key, frame);
    if (!body) return { type: "reject", reason: "decrypt" };

    // Signature against the sender's REGISTERED key.
    //
    // The canonical covers the WHOLE body, so a member who holds the
    // room key cannot rewrite the ttl, the view-once flag, the file
    // metadata, the file bytes or the key offer contents and still
    // pass this check. The body is hashed exactly as it arrived, not
    // as a cleaned-up version of it: sanitising for the UI happens
    // later, after the signature has bound these bytes to their
    // author.
    const canonical = await canonicalV3FromBody(this.roomId, body);
    const okSig = await verifyCanonical(entry.pubkey, canonical, body.sig);
    if (!okSig) return { type: "reject", reason: "signature" };

    // Replay: counters, timestamp window, frame-id dedup.
    const okReplay = this.replay.check({
      senderId: frame.from,
      sessionTag: body.sessionTag,
      counter: body.counter,
      ts: body.ts,
      id: frame.id,
    });
    if (!okReplay) return { type: "reject", reason: "replay" };

    switch (body.kind) {
      case "text":
        return { type: "text", body };
      case "typing":
        return { type: "typing", senderId: frame.from };
      case "spent":
        if (!body.messageId) return { type: "reject", reason: "shape" };
        return { type: "spent", messageId: body.messageId, senderId: frame.from };
      case "burn": {
        if (!body.messageId || !body.burnSig) return { type: "reject", reason: "shape" };
        const okBurn = await verifyCanonical(
          entry.pubkey,
          burnCanonical(this.roomId, frame.from, body.messageId),
          body.burnSig,
        );
        if (!okBurn) return { type: "reject", reason: "signature" };
        return { type: "burn", messageId: body.messageId, senderId: frame.from };
      }
      case "react": {
        // A mark is only valid if it is one of the product's four glyphs;
        // frames never carry arbitrary strings a page could abuse.
        if (!body.messageId || typeof body.text !== "string" || !isReactionMark(body.text)) {
          return { type: "reject", reason: "shape" };
        }
        return { type: "react", messageId: body.messageId, senderId: frame.from, mark: body.text };
      }
      case "cover":
        // Cover traffic: an encrypted, signed, replay-guarded frame whose
        // whole purpose is to be discarded. The relay cannot tell it from
        // a text frame (uniform size/post-padding); members may not. The
        // sender's counter still advances, which keeps the replay window
        // honest at no storage cost beyond the guard's own. Nothing else
        // happens. The UI never sees it.
        return { type: "cover" };
      case "file:meta": {
        if (!body.file?.messageId) return { type: "reject", reason: "shape" };
        if (!isSaneFileMeta(body.file)) return { type: "reject", reason: "shape" };
        // Bounded: a flood of orphan metas cannot grow the map forever.
        this.dropOldestFileIfNeeded();
        this.files.set(body.file.messageId, {
          meta: body.file,
          text: typeof body.text === "string" && body.text.length > 0 ? body.text : undefined,
          reply: isReplySnapshot(body.reply) ? body.reply : undefined,
          metaTs: body.ts,
          chunks: new Map(),
          bytes: 0,
        });
        return { type: "file-meta", senderId: frame.from };
      }
      case "file:chunk": {
        const c = body.chunk;
        if (!c || typeof c.messageId !== "string" || c.messageId.length === 0) {
          return { type: "reject", reason: "shape" };
        }
        // The chunk shape is fixed and known: a file is split into one
        // of the size buckets' chunk counts, each chunk at most
        // FILE_CHUNK_B64 characters, and the seq says which one this
        // is. Before this check, a sender could name any total and
        // any seq, so the assembler could be fed an unbounded number
        // of distinct chunks for one file and hold them all.
        if (!Number.isInteger(c.total) || !FILE_TOTALS.includes(c.total)) {
          return { type: "reject", reason: "shape" };
        }
        if (!Number.isInteger(c.seq) || c.seq < 0 || c.seq >= c.total) {
          return { type: "reject", reason: "shape" };
        }
        if (typeof c.dataB64 !== "string" || c.dataB64.length === 0) {
          return { type: "reject", reason: "shape" };
        }
        if (c.dataB64.length > FILE_CHUNK_B64) return { type: "reject", reason: "shape" };
        const known = this.files.get(c.messageId);
        if (!known) return { type: "reject", reason: "shape" };
        // The byte budget: the pending transfers may not hold more than
        // their ceiling of chunk strings. When a chunk does not fit,
        // the oldest transfers go until it does.
        const previous = known.chunks.get(c.seq);
        const delta = c.dataB64.length - (previous?.length ?? 0);
        if (this.pendingFileBytes + delta > this.pendingByteBudget) {
          this.evictFilesUntilRoom(delta);
        }
        const file = this.files.get(c.messageId);
        if (!file) return { type: "reject", reason: "shape" };
        if (this.pendingFileBytes + delta > this.pendingByteBudget) {
          return { type: "reject", reason: "shape" };
        }
        file.chunks.set(c.seq, c.dataB64);
        file.bytes += delta;
        this.pendingFileBytes += delta;
        if (file.chunks.size < c.total) return { type: "file-chunk", senderId: frame.from };
        // Complete: assemble, verify, deliver.
        this.files.delete(c.messageId);
        this.pendingFileBytes -= file.bytes;
        let padded = "";
        for (let i = 0; i < c.total; i++) padded += file.chunks.get(i) ?? "";
        const realLength = Math.ceil(file.meta.size / 3) * 4;
        const dataB64 = padded.slice(0, realLength);
        try {
          const sha = await sha256HexOfBytes(fromB64(dataB64));
          if (sha !== file.meta.sha) return { type: "reject", reason: "sha" };
        } catch {
          return { type: "reject", reason: "sha" };
        }
        return {
          type: "file",
          senderId: frame.from,
          ts: file.metaTs,
          text: file.text,
          reply: file.reply,
          file: { ...file.meta, dataB64 },
        };
      }
      case "key:offer":
        return this.openOffer(body.offer, frame.from);
      default:
        return { type: "reject", reason: "shape" };
    }
  }

  /** Keep the number of pending file transfers at or below the cap.
   *  The oldest transfer goes first, and its bytes come off the
   *  pending budget with it. */
  private dropOldestFileIfNeeded(): void {
    while (this.files.size >= MAX_PENDING_FILES) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) return;
      const dropped = this.files.get(oldest);
      this.files.delete(oldest);
      if (dropped) this.pendingFileBytes -= dropped.bytes;
    }
  }

  /** Drop the oldest pending transfers until a chunk of `incoming`
   *  characters fits inside the pending byte budget. */
  private evictFilesUntilRoom(incoming: number): void {
    while (this.pendingFileBytes + incoming > this.pendingByteBudget && this.files.size > 0) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) return;
      const dropped = this.files.get(oldest);
      this.files.delete(oldest);
      if (dropped) this.pendingFileBytes -= dropped.bytes;
    }
  }

  private async openOffer(offer: OfferBody | undefined, senderId: string): Promise<OpenResult> {
    if (!offer || offer.to !== this.selfId || typeof offer.kv !== "number") {
      return { type: "reject", reason: "offer" };
    }
    // Unwrap the entry-key layer (join deliveries only).
    let inner: { ecdhPubB64?: string; wrapIv?: string; wrapCt?: string } = offer;
    if (offer.outerIv && offer.outerCt) {
      const opened = await decryptJson<{ ecdhPubB64?: string; wrapIv?: string; wrapCt?: string }>(
        this.entryKey,
        offer.outerIv,
        offer.outerCt,
      );
      if (!opened?.ecdhPubB64 || !opened.wrapIv || !opened.wrapCt) {
        return { type: "reject", reason: "offer" };
      }
      inner = opened;
    }
    if (!inner.ecdhPubB64 || !inner.wrapIv || !inner.wrapCt) {
      return { type: "reject", reason: "offer" };
    }
    // Unknown-key-share defense: the ECDH key must be the one this
    // sender has in our registry.
    const regEcdh = this.registry.get(senderId)?.ecdhPubB64;
    if (!regEcdh || inner.ecdhPubB64 !== regEcdh) {
      return { type: "reject", reason: "offer" };
    }
    // Rotation offers may only come from the coordinator.
    if (offer.rot && senderId !== this.expectedCoordinator()) {
      return { type: "reject", reason: "offer" };
    }
    const payload = await ecdhUnwrapKey({
      myPrivJwk: this.ecdh.privJwk,
      theirPubRawB64: inner.ecdhPubB64,
      roomId: this.roomId,
      kv: offer.kv,
      wrapIv: inner.wrapIv,
      wrapCt: inner.wrapCt,
    });
    if (
      !payload ||
      typeof payload.keyB64 !== "string" ||
      payload.kv !== offer.kv ||
      typeof offer.kv !== "number" ||
      !Number.isSafeInteger(offer.kv) ||
      rotationEpochOf(offer.kv) > KVERSION_CAP ||
      offer.kv <= this.kv
    ) {
      return { type: "reject", reason: "offer" };
    }
    const keyRaw = fromB64(payload.keyB64);
    const key = await importAesKey(keyRaw);
    this.installKey(offer.kv, key, { rotation: !!offer.rot, raw: keyRaw });
    return { type: "offer-installed", kv: offer.kv, rotation: !!offer.rot };
  }
}

export { generateSessionEcdh };

/* ---------------- module registry of live ciphers ---------------- */

const ciphers = new Map<string, RoomCipher>();

export function getCipher(roomId: string): RoomCipher | undefined {
  return ciphers.get(roomId);
}

export function setCipher(roomId: string, cipher: RoomCipher): void {
  ciphers.set(roomId, cipher);
}

export function dropCipher(roomId: string): void {
  ciphers.delete(roomId);
}
