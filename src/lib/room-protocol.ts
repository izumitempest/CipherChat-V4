// RoomCipher — the per-room security engine. One instance per joined
// room, memory only. It owns:
//
//   the key ring         versioned room keys (v1 = password-derived
//                        entry key; later versions = random keys
//                        delivered over ECDH; old versions kept for a
//                        short decrypt-only grace window)
//   the member registry  frames only flow between current members —
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
  FILE_PAYLOAD_B64,
  FILE_TOTAL_CHUNKS,
  KEY_GRACE_MS,
  PENDING_MAX,
  PENDING_TTL_MS,
  canonicalV2,
  createReplayGuard,
  createSendClock,
  ecdhUnwrapKey,
  ecdhWrapKey,
  generateSessionEcdh,
  importAesKey,
  openFrame,
  padB64Payload,
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
import { isReactionMark } from "./types";

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
  sig: { privJwk: JsonWebKey; pubJwk: JsonWebKey };
  ecdh: SessionEcdh;
  /** the kv-1 password-derived key (from the room's key bundle) */
  entryKey: CryptoKey;
  now?: () => number;
  graceMs?: number;
  /** optional persistence for replay watermarks — survives refresh */
  watermarks?: WatermarkStore;
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
  | { type: "file-meta"; senderId: string }
  | { type: "file-chunk"; senderId: string }
  | {
      type: "file";
      senderId: string;
      ts: number;
      /** caption typed alongside the attachment — rides in the meta frame's
       * canonical-signed top-level text field, so it is nameplate-authentic */
      text?: string;
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

/** Hard ceiling for key versions. Offers claiming versions beyond this
 *  are rejected: a hostile member could otherwise install kv = 2^53 and
 *  permanently brick every future rotation (newKv would equal kv). */
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
  metaTs: number;
  chunks: Map<number, string>;
}

export class RoomCipher {
  readonly roomId: string;
  readonly selfId: string;
  readonly sigPubJwk: JsonWebKey;
  readonly ecdh: SessionEcdh;
  readonly registry = new Map<string, RegistryEntry>();
  kv = 1;

  private readonly sigPrivJwk: JsonWebKey;
  private readonly entryKey: CryptoKey;
  private readonly keys = new Map<number, InstalledKey>();
  private readonly clock: SendClock = createSendClock();
  private readonly replay: ReplayGuard;
  private readonly now: () => number;
  private readonly graceMs: number;
  private pending: { frame: WireFrame; at: number }[] = [];
  private readyQueue: WireFrame[] = [];
  private readonly files = new Map<string, AssemblingFile>();
  private readonly highWater: Record<string, number> = {};
  private readonly watermarks?: WatermarkStore;

  constructor(init: CipherInit) {
    this.roomId = init.roomId;
    this.selfId = init.selfId;
    this.sigPrivJwk = init.sig.privJwk;
    this.sigPubJwk = init.sig.pubJwk;
    this.ecdh = init.ecdh;
    this.entryKey = init.entryKey;
    this.now = init.now ?? Date.now;
    this.graceMs = init.graceMs ?? KEY_GRACE_MS;
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
      /* storage full/unavailable — defense degrades to per-page-load */
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
      kv > KVERSION_CAP
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
   *  their open results (the pair carries the frame id — the message id). */
  async drainPending(): Promise<{ frame: WireFrame; result: OpenResult }[]> {
    const out: { frame: WireFrame; result: OpenResult }[] = [];
    let guard = 0;
    while (this.readyQueue.length && guard++ < 128) {
      const frame = this.readyQueue.shift()!;
      out.push({ frame, result: await this.open(frame) });
    }
    return out;
  }

  /** The entry key (kv 1) — permanent, used to wrap join deliveries. */
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
   *  members (excluding the given ids — e.g. the leaver). Every client
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
      sigPrivJwk: this.sigPrivJwk,
      body,
      frameSize,
      frameId: extra?.frameId,
      to: extra?.to,
    });
  }

  async sealText(opts: { text: string; ttlSec?: number }): Promise<WireFrame[]> {
    return [
      await this.seal({ kind: "text", text: opts.text, ttlSec: opts.ttlSec }, CONTROL_FRAME_BYTES),
    ];
  }

  async sealTyping(): Promise<WireFrame[]> {
    return [await this.seal({ kind: "typing", typing: true }, CONTROL_FRAME_BYTES)];
  }

  async sealSpent(messageId: string): Promise<WireFrame[]> {
    return [await this.seal({ kind: "spent", messageId }, CONTROL_FRAME_BYTES)];
  }

  /** An ink margin mark on a message. The mark glyph rides the
   *  canonical-signed `text` field and the target rides `messageId` —
   *  both are signature-covered, so a mark is exactly as unforgeable
   *  as the words it annotates. */
  async sealReact(messageId: string, mark: string): Promise<WireFrame[]> {
    return [await this.seal({ kind: "react", messageId, text: mark }, CONTROL_FRAME_BYTES)];
  }

  /** Early burn of one of our own messages. Signed with the burn
   *  canonical, so nobody else can retire our letters. */
  async sealBurn(messageId: string): Promise<WireFrame[]> {
    const burnSig = await signCanonical(
      this.sigPrivJwk,
      burnCanonical(this.roomId, this.selfId, messageId),
    );
    return [await this.seal({ kind: "burn", messageId, burnSig }, CONTROL_FRAME_BYTES)];
  }

  /** A file becomes exactly 1 control-sized meta frame plus a FIXED
   *  number of uniform chunk frames — regardless of true file size. */
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
  }): Promise<WireFrame[]> {
    const padded = padB64Payload(opts.dataB64, FILE_PAYLOAD_B64);
    const messageId = crypto.randomUUID();
    const meta = await this.seal(
      {
        kind: "file:meta",
        messageId,
        // Top-level text is part of canonicalV2 — the caption is signed,
        // so it is exactly as authentic as the sender's words in text frames.
        text: opts.text,
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
    for (let seq = 0; seq < FILE_TOTAL_CHUNKS; seq++) {
      const dataB64 = padded.slice(seq * FILE_CHUNK_B64, (seq + 1) * FILE_CHUNK_B64);
      frames.push(
        await this.seal(
          { kind: "file:chunk", chunk: { messageId, seq, total: FILE_TOTAL_CHUNKS, dataB64 } },
          FILE_FRAME_BYTES,
        ),
      );
    }
    return frames;
  }

  /** Wrap a room key for one recipient over ECDH. Rotation offers ride
   *  in a frame sealed under the OLD key (recipients can still open
   *  it); join deliveries ride in a frame sealed under the ENTRY key
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
   *  fallback in the store — simultaneous fallbacks converge because
   *  version offers are monotonic).
   *
   *  `rot` marks the offer as the formal leave-ceremony (receivers
   *  verify the sender is their coordinator). Fallback re-seals use
   *  rot=false — a member-initiated delivery, still ECDH-wrapped,
   *  signature-checked, registry-gated and version-monotonic. */
  async rotateTo(minKv?: number, rot = true): Promise<WireFrame[]> {
    const newKv = Math.max(this.kv, minKv ?? 0) + 1;
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
   *  `minKv` is the server's rotation ledger (room epoch): a member
   *  re-joining after a refresh may have lost count of rotations, and a
   *  departed member may hold keys up to that version — so the new
   *  version must exceed it. Offers are sealed under the ENTRY key so
   *  every member can read them no matter which version they hold. */
  async rotateAsCoordinator(minKv?: number): Promise<WireFrame[]> {
    if (this.expectedCoordinator() !== this.selfId) return [];
    return this.rotateTo(minKv);
  }

  /** Deliver the CURRENT room key to a new member — ECDH-wrapped and
   *  additionally sealed under the entry key, so only a joiner who
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
      frame.v !== 2 ||
      typeof frame.ct !== "string" ||
      typeof frame.iv !== "string" ||
      typeof frame.from !== "string"
    ) {
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
      // Entry-sealed frame (key-delivery offer) — the entry key is
      // permanent, so these stay readable at any key version. The
      // secret inside is still wrapped pairwise over ECDH.
      key = this.entryKey;
    } else if (frame.kv === this.kv) {
      key = this.keys.get(frame.kv)?.key;
      if (!key) return { type: "reject", reason: "kv" };
    } else if (frame.kv > this.kv) {
      // Newer key version: either a rotation is in flight (we are one
      // offer behind) or we are a joiner awaiting delivery. Hold fresh
      // frames briefly; expire squatters; refuse anything stale.
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
    const canonical = canonicalV2({
      roomId: this.roomId,
      kv: frame.kv,
      senderId: frame.from,
      sessionTag: body.sessionTag,
      counter: body.counter,
      ts: body.ts,
      kind: body.kind,
      text: body.text,
      fileSha: body.fileSha,
      messageId: body.messageId,
    });
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
        // A mark is only valid if it is one of the product's four glyphs —
        // the wire never carries arbitrary strings a page could abuse.
        if (!body.messageId || typeof body.text !== "string" || !isReactionMark(body.text)) {
          return { type: "reject", reason: "shape" };
        }
        return { type: "react", messageId: body.messageId, senderId: frame.from, mark: body.text };
      }
      case "file:meta": {
        if (!body.file?.messageId) return { type: "reject", reason: "shape" };
        // Bounded: a flood of orphan metas cannot grow the map forever.
        if (this.files.size > 32) {
          const oldest = this.files.keys().next().value;
          if (oldest !== undefined) this.files.delete(oldest);
        }
        this.files.set(body.file.messageId, {
          meta: body.file,
          text: typeof body.text === "string" && body.text.length > 0 ? body.text : undefined,
          metaTs: body.ts,
          chunks: new Map(),
        });
        return { type: "file-meta", senderId: frame.from };
      }
      case "file:chunk": {
        const c = body.chunk;
        if (!c?.messageId || typeof c.seq !== "number" || typeof c.total !== "number") {
          return { type: "reject", reason: "shape" };
        }
        const file = this.files.get(c.messageId);
        if (!file) return { type: "reject", reason: "shape" };
        file.chunks.set(c.seq, c.dataB64 ?? "");
        if (file.chunks.size < c.total) return { type: "file-chunk", senderId: frame.from };
        // Complete — assemble, verify, deliver.
        this.files.delete(c.messageId);
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
          file: { ...file.meta, dataB64 },
        };
      }
      case "key:offer":
        return this.openOffer(body.offer, frame.from);
      default:
        return { type: "reject", reason: "shape" };
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
      offer.kv > KVERSION_CAP ||
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
