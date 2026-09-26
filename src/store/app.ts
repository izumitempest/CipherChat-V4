// The application store. One place owns: the desk (room cards),
// per-room message memory, member registries, the relay wiring, and
// the choreography of enter / unlock / send / burn.
//
// SECURITY MODEL (protocol v2, see lib/protocol.ts + lib/room-protocol.ts):
//   Every frame the relay carries is padded to a uniform size and
//   encrypted; typing, receipts, burns, key offers and file chunks all
//   ride the same indistinguishable frames. Replay protection, the
//   member-registry eviction gate, signature checks and the ECDH key
//   rotation ceremony all live in RoomCipher; this store is a thin
//   adapter that turns OpenResults into UI.

import { create } from "zustand";
import {
  isReactionMark,
  sanitizeReplySnapshot,
  type MessageView,
  type ReactionMark,
  type ReplySnapshot,
  type RoomCard,
  type Screen,
  type TtlChoice,
  type WireEnvelope,
  type Payload,
  type MemberPublic,
  type FilePayload,
} from "@/lib/types";
import {
  verifyCanonical,
  canonicalFor,
  decryptJson,
  sha256HexOfBytes,
  fromB64,
} from "@/lib/crypto";
import { aliasFromFingerprint, inkFromFingerprint } from "@/lib/identity";
import { notifyIncoming } from "@/lib/notifications";
import { createKeyBundleV2, unlockWithBundle } from "@/lib/kdf";
import { loadDeviceSeed, deriveRoomSigningKey } from "@/lib/room-identity";
import {
  RoomCipher,
  generateSessionEcdh,
  getCipher,
  setCipher,
  dropCipher,
  type OpenResult,
} from "@/lib/room-protocol";
import type { WireFrame } from "@/lib/protocol";
import {
  getSession,
  setSession,
  dropSession,
  sessionRoomIds,
  type RoomSession,
} from "@/lib/session";
import {
  loadRoomCards,
  upsertRoomCard,
  patchRoomCard,
  removeRoomCard,
  clearUnread,
  loadRoomSettings,
  saveRoomSettings,
  loadVerified,
  saveVerified,
  saveCreatorToken,
  loadCreatorToken,
  sweepBurnedRooms,
  roomWatermarkStore,
} from "@/lib/local";
import { getRelay } from "@/lib/relay";
import { SILENT_GRACE_MS, stillSilentAtExpiry } from "@/lib/silent-grace";
import { ROOM_TTL_DEFAULT_SEC } from "@/lib/room-ttl";
import { dropDraft } from "@/lib/drafts";
import { fmtTtlRemaining } from "@/lib/format";

export const FILE_LIMIT = 2 * 1024 * 1024; // 2 MB; nothing is stored anywhere

export interface SealingState {
  roomId: string;
  label: string;
}

export interface JoinResult {
  ok: boolean;
  reason?:
    | "wrong-password"
    | "not-found"
    | "burned"
    | "expired"
    | "room-full"
    | "error";
}

/** Someone is writing. Transient, expires by its own clock. */
export interface TypingSignal {
  memberId: string;
  alias: string;
  at: number;
}

interface AppState {
  ready: boolean;
  seed: Uint8Array | null;
  screen: Screen;
  activeRoomId: string | null;
  inviteCode: string | null;
  /** The porch's hand-off: /?app=1&create=1#/new arrived,
   *  consumed (and cleaned from the URL) during init, so the
   *  landing can open the create form on its first render. */
  porchCreate: boolean;

  roomCards: RoomCard[];
  messages: Record<string, MessageView[]>;
  members: Record<string, MemberPublic[]>;
  typing: Record<string, TypingSignal[]>;
  relayOnline: boolean;
  resealing: Record<string, boolean>;
  sealing: SealingState | null;
  burn: { roomId: string } | null;

  init: () => Promise<void>;
  navigate: (screen: Screen, roomId?: string | null) => void;
  syncHash: () => void;
  createRoom: (
    localName: string,
    password: string,
    ttlSec?: number,
  ) => Promise<JoinResult>;
  joinRoom: (code: string, password: string, localName?: string) => Promise<JoinResult>;
  enterRoom: (session: RoomSession, localName: string, rejoined: boolean) => Promise<void>;
  /** Creator-only: change the room's lifetime while it lives. */
  adjustRoomTtl: (roomId: string, ttlSec: number) => Promise<{ ok: boolean; reason?: string }>;
  /** The room's time ran out while we were in it: mark and step out. */
  closeExpiredRoom: (roomId: string) => void;
  sendMessage: (
    text: string,
    file?: Omit<FilePayload, "sha"> & { viewOnce?: boolean },
    ttlOverride?: TtlChoice,
    reply?: ReplySnapshot,
  ) => Promise<void>;
  emitTyping: (roomId: string) => void;
  spendViewOnce: (roomId: string, messageId: string) => void;
  reactToMessage: (roomId: string, messageId: string, mark: string) => void;
  burnMessage: (roomId: string, messageId: string) => Promise<void>;
  burnRoom: (roomId: string) => Promise<void>;
  finishRoomBurn: (roomId: string) => void;
  leaveRoom: (roomId: string) => Promise<void>;
  reportRoom: (roomId: string) => Promise<void>;
  renameRoom: (roomId: string, name: string) => void;
  setDefaultTtl: (roomId: string, ttl: TtlChoice) => void;
  markVerified: (roomId: string, memberId: string, verified: boolean) => void;
  isVerified: (roomId: string, memberId: string) => boolean;
  refreshMembers: (roomId: string) => Promise<void>;
}

/* ------------ TTL burn scheduling (module memory) ------------ */
const burnTimers = new Map<string, ReturnType<typeof setTimeout>>();

/* ------------ typing whispers (transient by design) ------------ */
const TYPING_TTL_MS = 3500;
const TYPING_EMIT_THROTTLE_MS = 2500;
const typingLastEmit = new Map<string, number>();
const typingPruneTimers = new Map<string, ReturnType<typeof setTimeout>>();

/* ------------ join-key requests (self-healing delivery) ------------ */
const KEYREQ_THROTTLE_MS = 5000;
const keyReqLastEmit = new Map<string, number>();

function pruneTypingLater(roomId: string) {
  const existing = typingPruneTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    typingPruneTimers.delete(roomId);
    useApp.setState((s) => {
      const fresh = (s.typing[roomId] ?? []).filter(
        (x) => Date.now() - x.at < TYPING_TTL_MS,
      );
      return { typing: { ...s.typing, [roomId]: fresh } };
    });
  }, TYPING_TTL_MS + 100);
  typingPruneTimers.set(roomId, t);
}

function clearTyping(roomId: string, memberId: string) {
  useApp.setState((s) => {
    const list = s.typing[roomId] ?? [];
    if (!list.some((t) => t.memberId === memberId)) return {};
    return {
      typing: {
        ...s.typing,
        [roomId]: list.filter((t) => t.memberId !== memberId),
      },
    };
  });
}

/** The single transition rule for ink marks: setting a mark you already
 *  hold clears it; setting a different one moves yours; each sender holds
 *  at most one mark per message. Applied identically by the optimistic
 *  local update and by every receiver, so the frames converge. */
function applyMarkToggle(
  list: MessageView[],
  messageId: string,
  senderId: string,
  mark: ReactionMark,
): MessageView[] {
  return list.map((m) => {
    if (m.id !== messageId || m.kind === "system") return m;
    const marks: Partial<Record<ReactionMark, string[]>> = { ...(m.marks ?? {}) };
    if ((marks[mark] ?? []).includes(senderId)) {
      const next = (marks[mark] ?? []).filter((id) => id !== senderId);
      if (next.length > 0) marks[mark] = next;
      else delete marks[mark];
    } else {
      for (const k of Object.keys(marks) as ReactionMark[]) {
        const kept = (marks[k] ?? []).filter((id) => id !== senderId);
        if (kept.length > 0) marks[k] = kept;
        else delete marks[k];
      }
      marks[mark] = [...(marks[mark] ?? []), senderId];
    }
    return { ...m, marks };
  });
}

function scheduleBurn(
  roomId: string,
  messageId: string,
  expiresAt: number,
  onBurn: (roomId: string, messageId: string) => void,
) {
  if (burnTimers.has(messageId)) return;
  const delay = Math.max(0, expiresAt - Date.now());
  const t = setTimeout(() => {
    burnTimers.delete(messageId);
    onBurn(roomId, messageId);
  }, delay);
  burnTimers.set(messageId, t);
}

function cancelBurns(roomId: string, messages: MessageView[]) {
  for (const m of messages) {
    if (m.id) {
      const t = burnTimers.get(m.id);
      if (t) {
        clearTimeout(t);
        burnTimers.delete(m.id);
      }
    }
  }
  void roomId;
}

const MIN_SEAL_MS = 1700; // the vault moment takes at least this long, on purpose

// Set synchronously at the top of init(); see the comment there.
let initStarted = false;

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  seed: null,
  screen: "landing",
  activeRoomId: null,
  inviteCode: null,
  porchCreate: false,

  roomCards: [],
  messages: {},
  members: {},
  typing: {},
  relayOnline: false,
  resealing: {},
  sealing: null,
  burn: null,

  /* -------------------------------------------------- init ---- */

  init: async () => {
    // The synchronous flag matters: `ready` is only set after an
    // await, so two concurrent init() calls (a remount racing the
    // first mount) would BOTH pass the ready check and register every
    // relay handler twice. The flag has no await before it.
    if (initStarted || get().ready) return;
    initStarted = true;
    // One random seed per device; every room derives its own signing
    // key from it, so registries can never be correlated across rooms.
    const seed = await loadDeviceSeed();
    // Burned rooms showed their ash last session; now they are gone.
    const cards = sweepBurnedRooms();

    // The porch's seal gesture ends here: /?app=1&create=1#/new
    // arrives expecting the create form already out. Read once,
    // here (client-side, post-hydration, beside the hash routing
    // it accompanies), and cleaned from the URL so a refresh
    // never re-opens the sheet at the user.
    const search = new URLSearchParams(window.location.search);
    const porchCreate = search.get("create") === "1";
    if (porchCreate) {
      search.delete("create");
      const qs = search.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          (qs ? `?${qs}` : "") +
          window.location.hash,
      );
    }

    set({ seed, roomCards: cards, ready: true, porchCreate });

    get().syncHash();
    window.addEventListener("hashchange", () => get().syncHash());

    wireRelay(set, get);
  },

  syncHash: () => {
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (hash.startsWith("join")) {
      const code = hash.split("/")[1] ?? "";
      set({ screen: "invite", inviteCode: code || null, activeRoomId: null });
      return;
    }
    if (hash.startsWith("new")) {
      set({ screen: "landing", activeRoomId: null });
      return;
    }
    if (hash.startsWith("rooms")) {
      set({ screen: "rooms", activeRoomId: null });
      return;
    }
    if (hash.startsWith("r/")) {
      const roomId = hash.slice(2);
      const session = getSession(roomId);
      set({ screen: "chat", activeRoomId: roomId });
      if (session) {
        patchRoomCard(roomId, { unread: false, unreadCount: 0 });
        set({ roomCards: loadRoomCards() });
      }
      // No keys in memory: the room is locked. A first-class state,
      // never an error.
      return;
    }
    // Root: the desk if you have rooms, the landing if you don't.
    if (get().roomCards.length > 0) {
      set({ screen: "rooms", activeRoomId: null });
    } else {
      set({ screen: "landing", activeRoomId: null });
    }
  },

  navigate: (screen, roomId = null) => {
    const hash =
      screen === "rooms"
        ? "#/rooms"
        : screen === "chat" && roomId
          ? `#/r/${roomId}`
          : screen === "invite"
            ? "#/join"
            : screen === "landing"
              ? "#/new"
              : "#/";
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      get().syncHash();
    }
  },

  /* ----------------------------------------------- create ---- */

  createRoom: async (localName, password, ttlSec) => {
    const seed = get().seed;
    if (!seed) return { ok: false, reason: "error" };

    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttlSec: ttlSec ?? ROOM_TTL_DEFAULT_SEC }),
    });
    if (!res.ok) return { ok: false, reason: "error" };
    const { roomId, creatorToken, expiresAt } = await res.json();
    saveCreatorToken(roomId, creatorToken);

    set({ sealing: { roomId, label: "Sealing the room" } });
    const started = Date.now();

    // This room's own signing identity + session ECDH pair, and the
    // argon2id key bundle (random salt, versioned, memory-hard).
    const [identity, ecdh, bundle] = await Promise.all([
      deriveRoomSigningKey(seed, roomId),
      generateSessionEcdh(),
      createKeyBundleV2(password),
    ]);

    await Promise.all([
      fetch(`/api/rooms/${roomId}/verifier`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifier: JSON.stringify(bundle.bundle) }),
      }),
      new Promise((r) => setTimeout(r, MIN_SEAL_MS - (Date.now() - started))),
    ]);

    const alias = aliasFromFingerprint(identity.fingerprintHex);
    const colorIdx = inkFromFingerprint(identity.fingerprintHex);
    const joinRes = await fetch(`/api/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: identity.pubJwk,
        ecdhPub: ecdh.pubRawB64,
        alias,
        colorIdx,
      }),
    });
    if (!joinRes.ok) {
      set({ sealing: null });
      return { ok: false, reason: "error" };
    }
    const { memberId } = await joinRes.json();

    const cipher = new RoomCipher({
      roomId,
      selfId: memberId,
      sig: { privJwk: identity.privJwk, pubJwk: identity.pubJwk },
      ecdh,
      entryKey: bundle.key,
      watermarks: roomWatermarkStore(roomId),
    });
    setCipher(roomId, cipher);

    const session: RoomSession = {
      roomId,
      memberId,
      alias,
      colorIdx,
      kv: 1,
      // Kept in the memory-only session: the invite sheet re-shares
      // it (masked, toggle to reveal) for as long as the room is open.
      password,
      creatorToken,
      expiresAt: expiresAt ? Date.parse(expiresAt) : undefined,
      defaultTtl: loadRoomSettings(roomId).defaultTtl,
      legacy: false,
    };
    setSession(session);
    set({ sealing: null });
    await get().enterRoom(session, localName || "New room", false);
    return { ok: true };
  },

  /* ------------------------------------------------- join ---- */

  joinRoom: async (code, password, localName) => {
    const seed = get().seed;
    if (!seed) return { ok: false, reason: "error" };

    const infoRes = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    if (!infoRes.ok) {
      const info = await infoRes.json().catch(() => ({}));
      return {
        ok: false,
        reason: info?.burned ? "burned" : info?.expired ? "expired" : "not-found",
      };
    }
    const info = await infoRes.json();
    if (info.memberCount >= info.memberCap) {
      return { ok: false, reason: "room-full" };
    }

    set({ sealing: { roomId: code, label: "Sealing the room" } });
    const started = Date.now();
    // The entry key (version 1): argon2id for new rooms, PBKDF2 for
    // rooms created before the upgrade. The bundle decides.
    const entryKey = await unlockWithBundle(password, info.verifier, code, info.epoch);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, MIN_SEAL_MS - (Date.now() - started))),
    );

    if (!entryKey) {
      set({ sealing: null });
      return { ok: false, reason: "wrong-password" };
    }

    const [identity, ecdh] = await Promise.all([
      deriveRoomSigningKey(seed, code),
      generateSessionEcdh(),
    ]);
    const alias = aliasFromFingerprint(identity.fingerprintHex);
    const colorIdx = inkFromFingerprint(identity.fingerprintHex);
    const joinRes = await fetch(`/api/rooms/${code}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: identity.pubJwk,
        ecdhPub: ecdh.pubRawB64,
        alias,
        colorIdx,
      }),
    });
    if (!joinRes.ok) {
      set({ sealing: null });
      if (joinRes.status === 403) return { ok: false, reason: "room-full" };
      return { ok: false, reason: "error" };
    }
    const { memberId, rejoined } = await joinRes.json();

    const cipher = new RoomCipher({
      roomId: code,
      selfId: memberId,
      sig: { privJwk: identity.privJwk, pubJwk: identity.pubJwk },
      ecdh,
      entryKey,
      watermarks: roomWatermarkStore(code),
    });
    setCipher(code, cipher);

    // v1 rooms (versionless key bundles) keep the legacy receive path;
    // v2 rooms refuse v1 envelopes outright.
    let legacyRoom = true;
    try {
      legacyRoom = !info.verifier || JSON.parse(info.verifier)?.v !== 2;
    } catch {
      legacyRoom = true;
    }

    const session: RoomSession = {
      roomId: code,
      memberId,
      alias,
      colorIdx,
      kv: 1, // the current key arrives via ECDH offers if the room has rotated
      password,
      creatorToken: loadCreatorToken(code),
      expiresAt: info.expiresAt ? Date.parse(info.expiresAt) : undefined,
      defaultTtl: loadRoomSettings(code).defaultTtl,
      legacy: legacyRoom,
    };
    setSession(session);
    set({ sealing: null });
    const name =
      localName ||
      get().roomCards.find((c) => c.roomId === code)?.localName ||
      `Room ${code.slice(0, 4)}`;
    await get().enterRoom(session, name, !!rejoined);

    // The server's epoch is the rotation LEDGER (it persists; keys do
    // not). If the room has rotated before and we are back at the
    // password-derived key (a rejoin after refresh, or a fresh join),
    // the current key must arrive via ECDH offers. Give live members a
    // moment to deliver; if nobody does (everyone refreshed), the
    // coordinator re-seals past the ledger so keys any departed member
    // may still hold are dead again.
    if (info.epoch > 1) {
      const attemptRotation = (minKv: number) => {
        const c = getCipher(code);
        const s = getSession(code);
        if (!c || !s || c.kv > 1) return;
        void c.rotateTo(minKv).then((offers) => {
          const relay2 = getRelay();
          for (const f of offers) {
            relay2.emit("message:send", { roomId: code, envelope: f });
          }
          addSystemLine(code, "The room re-sealed for those who remain.");
        });
      };
      setTimeout(() => {
        const cipher2 = getCipher(code);
        const session2 = getSession(code);
        if (!cipher2 || !session2 || cipher2.kv > 1) return;
        if (cipher2.expectedCoordinator() === session2.memberId) {
          attemptRotation(info.epoch);
        } else {
          // Ask the room for the current key; a live key-holder answers
          // with an ECDH offer.
          getRelay().emit("key:request", { roomId: code, from: session.memberId });
          setResealing(code, true);
          // Fallback: if nobody answers (every member refreshed, or the
          // holder is offline), re-seal on our own after a randomized
          // delay. The version jump is randomized too, so simultaneous
          // fallbacks converge: a lower-version holder always accepts
          // a higher-version offer.
          setTimeout(() => {
            const c = getCipher(code);
            const s = getSession(code);
            if (!c || !s || c.kv > 1) return;
            void c.rotateTo(info.epoch + 1 + Math.floor(Math.random() * 8), false).then((offers) => {
              const relay2 = getRelay();
              for (const f of offers) {
                relay2.emit("message:send", { roomId: code, envelope: f });
              }
              addSystemLine(code, "The room re-sealed for those who remain.");
              setResealing(code, false);
            });
          }, 5000 + Math.floor(Math.random() * 3000));
        }
      }, 3000);
    }
    return { ok: true };
  },

  /* ----------------------------------------------- enter ----- */

  enterRoom: async (session, localName, rejoined) => {
    const now = Date.now();
    upsertRoomCard({
      roomId: session.roomId,
      localName,
      createdAt: now,
      lastActivity: now,
      lastMembers: 1,
      unread: false,
      unreadCount: 0,
      burned: false,
      locked: false,
      expiresAt: session.expiresAt,
    });
    set({ roomCards: loadRoomCards() });

    // Fresh message memory: there is no backlog, ever.
    set((s) => ({ messages: { ...s.messages, [session.roomId]: [] } }));

    // A room with a clock announces it once, on entry; everyone
    // deserves to know when the door closes.
    if (session.expiresAt && session.expiresAt > Date.now()) {
      addSystemLine(
        session.roomId,
        `This room closes in ${fmtTtlRemaining(session.expiresAt - Date.now())} - then it's gone for everyone.`,
      );
    }

    await get().refreshMembers(session.roomId);

    const cipher = getCipher(session.roomId);
    const relay = getRelay();
    relay.emit("room:join", {
      roomId: session.roomId,
      memberId: session.memberId,
      alias: session.alias,
      colorIdx: session.colorIdx,
      pubkey: cipher?.sigPubJwk,
      ecdhPub: cipher?.ecdh.pubRawB64,
      rejoined,
    });
    set({ relayOnline: relay.connected });

    get().navigate("chat", session.roomId);
  },

  refreshMembers: async (roomId) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`);
      if (!res.ok) return;
      const { members } = (await res.json()) as { members: MemberPublic[] };
      set((s) => ({ members: { ...s.members, [roomId]: members } }));

      // Keep the cipher's registry in sync; it is the eviction gate.
      const cipher = getCipher(roomId);
      if (cipher) {
        const seen = new Set<string>();
        for (const m of members) {
          seen.add(m.memberId);
          const cur = cipher.registry.get(m.memberId);
          cipher.registry.set(m.memberId, {
            pubkey: m.pubkey,
            ecdhPubB64: m.ecdhPub ?? cur?.ecdhPubB64,
            connected: cur?.connected ?? true,
            joinedAt: m.joinedAt ?? cur?.joinedAt,
            alias: m.alias,
            colorIdx: m.colorIdx,
          });
        }
        for (const id of [...cipher.registry.keys()]) {
          if (!seen.has(id)) cipher.registry.delete(id);
        }
      }
    } catch {
      /* offline: the registry stays as-is */
    }
  },

  /* ------------------------------------------------- send ---- */

  sendMessage: async (text, file, ttlOverride, reply) => {
    const viewOnce = !!file?.viewOnce;
    const { activeRoomId } = get();
    if (!activeRoomId) return;
    const session = getSession(activeRoomId);
    const cipher = getCipher(activeRoomId);
    if (!session || !cipher) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;

    const ttlSec = (ttlOverride !== undefined ? ttlOverride : session.defaultTtl) || undefined;
    const ts = Date.now();

    let frames: WireFrame[];
    if (file) {
      const sha = await sha256HexOfBytes(fromB64(file.dataB64));
      frames = await cipher.sealFile({
        name: file.name,
        mime: file.mime,
        size: file.size,
        dataB64: file.dataB64,
        sha,
        // The caption rides the meta frame's canonical-signed text field.
        text: trimmed || undefined,
        ttlSec,
        viewOnce: viewOnce || undefined,
        reply,
      });
    } else {
      frames = await cipher.sealText({ text: trimmed, ttlSec, reply });
    }
    // The first frame's id IS the message id (text frame, or the file
    // meta frame); the relay acks it and the view flips to "sent".
    const id = frames[0].id;

    const kind = file ? "file" : "text";
    const view: MessageView = {
      id,
      kind,
      senderId: session.memberId,
      senderAlias: session.alias,
      senderColor: session.colorIdx,
      self: true,
      status: "sending",
      ts,
      text: trimmed,
      file: file
        ? { name: file.name, mime: file.mime, size: file.size, dataB64: file.dataB64 }
        : undefined,
      ttlSec,
      expiresAt: ttlSec ? ts + ttlSec * 1000 : undefined,
      viewOnce: file && viewOnce ? true : undefined,
      replyTo: reply,
    };

    set((s) => ({
      messages: {
        ...s.messages,
        [session.roomId]: [...(s.messages[session.roomId] ?? []), view],
      },
    }));
    patchRoomCard(session.roomId, { lastActivity: ts });
    set({ roomCards: loadRoomCards() });

    if (ttlSec) {
      scheduleBurn(session.roomId, id, ts + ttlSec * 1000, onMessageBurn);
    }

    const relay = getRelay();
    for (const f of frames) {
      relay.emit("message:send", { roomId: session.roomId, envelope: f });
    }
  },

  /* --------------------------------------------- typing ------- */

  emitTyping: (roomId) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher) return;
    const now = Date.now();
    const last = typingLastEmit.get(roomId) ?? 0;
    if (now - last < TYPING_EMIT_THROTTLE_MS) return;
    typingLastEmit.set(roomId, now);
    // Typing rides the same uniform encrypted frames as everything
    // else; the relay cannot even tell WHEN someone is typing.
    void cipher.sealTyping().then((frames) => {
      const relay = getRelay();
      for (const f of frames) relay.emit("message:send", { roomId, envelope: f });
    });
  },

  /* --------------------------------------------- view-once --- */

  spendViewOnce: (roomId, messageId) => {
    set((s) => {
      const list = s.messages[roomId] ?? [];
      return {
        messages: {
          ...s.messages,
          [roomId]: list.map((m) => (m.id === messageId ? { ...m, spent: true } : m)),
        },
      };
    });
    const cipher = getCipher(roomId);
    if (cipher) {
      void cipher.sealSpent(messageId).then((frames) => {
        const relay = getRelay();
        for (const f of frames) relay.emit("message:send", { roomId, envelope: f });
      });
    }
  },

  /* -------------------------------------------- ink marks --- */

  /** Set or clear one of the four quiet margin marks on any message.
   *  The frame is signed (canonical covers mark + target), so a mark
   *  is exactly as authentic as the words it annotates. */
  reactToMessage: (roomId, messageId, mark) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher || !isReactionMark(mark)) return;
    // Optimistic local toggle; the frame carries the same transition
    // for everyone else.
    useApp.setState((s) => ({
      messages: {
        ...s.messages,
        [roomId]: applyMarkToggle(s.messages[roomId] ?? [], messageId, session.memberId, mark),
      },
    }));
    void cipher.sealReact(messageId, mark).then((frames) => {
      const relay = getRelay();
      for (const f of frames) relay.emit("message:send", { roomId, envelope: f });
    });
  },

  /* --------------------------------------------- burn-one ---- */

  /** Retire one of your own letters ahead of its clock. The announce
   *  is signed inside the encrypted frame, so only the author can do
   *  this; nobody else can burn a message they did not write. */
  burnMessage: async (roomId, messageId) => {
    const { activeRoomId } = get();
    const target = roomId ?? activeRoomId;
    const session = getSession(target);
    const cipher = getCipher(target);
    const msg = (get().messages[target] ?? []).find((m) => m.id === messageId);
    if (!session || !cipher || !msg || !msg.self || msg.kind === "system") return;

    const frames = await cipher.sealBurn(messageId);
    const relay = getRelay();
    for (const f of frames) relay.emit("message:send", { roomId: target, envelope: f });

    const t = burnTimers.get(messageId);
    if (t) {
      clearTimeout(t);
      burnTimers.delete(messageId);
    }
    onMessageBurn(target, messageId);
  },

  /* ------------------------------------------------- burn ---- */

  burnRoom: async (roomId) => {
    const session = getSession(roomId);
    if (!session?.creatorToken) return;
    try {
      await fetch(`/api/rooms/${roomId}/burn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: session.creatorToken }),
      });
    } catch {
      /* even if this fails, members burn on the announce */
    }
    getRelay().emit("room:burn", { roomId });
    set({ burn: { roomId } });
  },

  finishRoomBurn: (roomId) => {
    const messages = get().messages[roomId] ?? [];
    cancelBurns(roomId, messages);
    dropSession(roomId);
    dropCipher(roomId);
    clearRoomGrace(roomId);
    dropDraft(roomId);
    patchRoomCard(roomId, { burned: true, unread: false, lastActivity: Date.now() });
    set((s) => ({
      burn: null,
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: { ...s.messages, [roomId]: [] },
    }));
    get().navigate("rooms");
  },

  /* ----------------------------------------------- report --- */

  /** Report this room for abuse, as a member: the report is signed
   *  with the room's signing key (cc-report-v1), so the server treats
   *  it as credible and burns the room at once: the graded-report
   *  fix for Round 31's anonymous kill switch, where a room ID alone
   *  (the weakest credential, one carried in every forwarded
   *  invite link) could end the room. Members are the only credible
   *  content reporters; a stranger's report now needs corroboration
   *  from three distinct networks. */
  reportRoom: async (roomId) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher) return;
    const proof = await cipher.signReportProof();
    try {
      await fetch(`/api/rooms/${roomId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId: session.memberId,
          ts: proof.ts,
          sig: proof.sig,
        }),
      });
    } catch {
      /* best effort: the room may already be gone; the relay's
       * room:burned (sent by the server's terminate call) still
       * reaches us and runs the same burn sequence */
    }
    // Same local burn sequence a creator's burn or a relay announce
    // triggers: a reported room is indistinguishable from a burned
    // one, by design.
    set({ burn: { roomId } });
  },

  /* ------------------------------------------------- leave --- */

  leaveRoom: async (roomId) => {
    const session = getSession(roomId);
    if (session) {
      // Proof-of-possession: sign the departure with the room's signing
      // key so nobody can write us out (and rotate the room out from
      // under everyone) with just our memberId.
      const cipher = getCipher(roomId);
      if (cipher) {
        const proof = await cipher.signDepartureProof();
        try {
          await fetch(`/api/rooms/${roomId}/leave`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ memberId: session.memberId, ts: proof.ts, sig: proof.sig }),
          });
        } catch {
          /* best effort: receivers rotate on the announce regardless */
        }
      }
      // No cipher (locked/refreshed tab): skip the REST call entirely;
      // the server now demands a proof we cannot make without the key.
      // The relay announce below still tells receivers, who handle a
      // keyless departure via the silent-eviction grace path.
      getRelay().emit("member:leave", {
        roomId,
        memberId: session.memberId,
        alias: session.alias,
      });
    }
    const messages = get().messages[roomId] ?? [];
    cancelBurns(roomId, messages);
    dropSession(roomId);
    dropCipher(roomId);
    clearRoomGrace(roomId);
    dropDraft(roomId);
    removeRoomCard(roomId);
    set((s) => ({
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: { ...s.messages, [roomId]: [] },
    }));
    get().navigate("rooms");
  },

  /* ---------------------------------------------- settings --- */

  renameRoom: (roomId, name) => {
    patchRoomCard(roomId, { localName: name });
    set({ roomCards: loadRoomCards() });
  },

  setDefaultTtl: (roomId, ttl) => {
    const session = getSession(roomId);
    if (session) session.defaultTtl = ttl;
    saveRoomSettings(roomId, { defaultTtl: ttl });
  },

  /* ------------------------------------------ room lifetime --- */

  adjustRoomTtl: async (roomId, ttlSec) => {
    const session = getSession(roomId);
    const token = session?.creatorToken ?? loadCreatorToken(roomId);
    if (!token) return { ok: false, reason: "not-creator" };
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: token, ttlSec }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, reason: body?.error ?? "error" };
      }
      const { expiresAt } = await res.json();
      const ms = expiresAt ? Date.parse(expiresAt) : undefined;
      if (session) session.expiresAt = ms;
      patchRoomCard(roomId, { expiresAt: ms });
      set({ roomCards: loadRoomCards() });
      return { ok: true };
    } catch {
      return { ok: false, reason: "error" };
    }
  },

  closeExpiredRoom: (roomId) => {
    // The desk remembers it as closed for this session, like ash.
    patchRoomCard(roomId, { closed: true, locked: true });
    set((s) => ({
      roomCards: loadRoomCards(),
      activeRoomId: s.activeRoomId === roomId ? null : s.activeRoomId,
      screen: s.activeRoomId === roomId ? "rooms" : s.screen,
    }));
    // Tell the room we've gone (they'll each hit the closed door on
    // their own clock or their next re-entry attempt).
    const session = getSession(roomId);
    if (session) {
      getRelay().emit("member:leave", {
        roomId,
        memberId: session.memberId,
        alias: session.alias,
      });
    }
  },

  markVerified: (roomId, memberId, verified) => {
    const current = loadVerified(roomId);
    const next = verified
      ? Array.from(new Set([...current, memberId]))
      : current.filter((id) => id !== memberId);
    saveVerified(roomId, next);
    set((s) => ({ members: { ...s.members } })); // trigger re-render
  },

  isVerified: (roomId, memberId) => loadVerified(roomId).includes(memberId),
}));

/* ==================================================================
   Relay wiring: one socket, registered once, drives the whole house
   ================================================================== */

function onMessageBurn(roomId: string, messageId: string) {
  // Phase 1: burning (CSS animation 600ms)
  useApp.setState((s) => ({
    messages: {
      ...s.messages,
      [roomId]: (s.messages[roomId] ?? []).map((m) =>
        m.id === messageId ? { ...m, status: "burning" } : m,
      ),
    },
  }));
  // Phase 2: gone.
  setTimeout(() => {
    useApp.setState((s) => ({
      messages: {
        ...s.messages,
        [roomId]: (s.messages[roomId] ?? []).filter((m) => m.id !== messageId),
      },
    }));
  }, 620);
}

function addSystemLine(roomId: string, text: string) {
  const line: MessageView = {
    id: crypto.randomUUID(),
    kind: "system",
    status: "sent",
    ts: Date.now(),
    text,
  };
  useApp.setState((s) => ({
    messages: {
      ...s.messages,
      [roomId]: [...(s.messages[roomId] ?? []), line],
    },
  }));
}

function patchView(roomId: string, messageId: string, patch: Partial<MessageView>) {
  useApp.setState((s) => ({
    messages: {
      ...s.messages,
      [roomId]: (s.messages[roomId] ?? []).map((m) =>
        m.id === messageId ? { ...m, ...patch } : m,
      ),
    },
  }));
}

/** Room-card touch. `letters` > 0 counts real letters for the
 *  unread badge (dot-only for joins and rejections); unread=false
 *  (the room is being read) always resets the count. */
function touchCard(roomId: string, unread: boolean, letters = 0) {
  const card = loadRoomCards().find((c) => c.roomId === roomId);
  const nextCount = unread
    ? Math.min(99, (card?.unreadCount ?? 0) + letters)
    : 0;
  patchRoomCard(roomId, {
    lastActivity: Date.now(),
    unread,
    ...(unread || letters > 0 || card?.unreadCount ? { unreadCount: nextCount } : {}),
  });
  useApp.setState({ roomCards: loadRoomCards() });
}

/* The room's local name, for notices that name the room. */
function roomNameOf(roomId: string): string {
  return (
    useApp.getState().roomCards.find((c) => c.roomId === roomId)?.localName ?? "Room"
  );
}

function setResealing(roomId: string, value: boolean) {
  useApp.setState((s) => {
    const next = { ...s.resealing };
    if (value) next[roomId] = true;
    else delete next[roomId];
    return { resealing: next };
  });
}

/* ==================================================================
   Silent-departure grace (Task 21.1)

   A member whose connection silently drops (no clean leave, just a
   closed laptop) keeps the room key until the room re-seals. Every
   unlocked client quietly watches each offline member; when the
   grace window expires, the CONNECTED COORDINATOR (smallest memberId
   among live members) asks the server to write them out. The server
   consults the relay's presence clock before agreeing (see
   /api/rooms/:id/evict), so a forged or premature request gains
   nothing. Peers then treat it exactly like a departure: REST-
   confirmed eviction, random new key, pairwise ECDH delivery.
   ================================================================== */

const silentGrace = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

function startGraceTimer(roomId: string, memberId: string) {
  const session = getSession(roomId);
  if (!session || session.memberId === memberId) return; // nothing to act with; never for self
  let room = silentGrace.get(roomId);
  if (!room) {
    room = new Map();
    silentGrace.set(roomId, room);
  }
  if (room.has(memberId)) return;
  room.set(
    memberId,
    setTimeout(() => {
      room.delete(memberId);
      void fireSilentEviction(roomId, memberId);
    }, SILENT_GRACE_MS),
  );
}

function cancelGraceTimer(roomId: string, memberId: string) {
  silentGrace.get(roomId)?.delete(memberId);
}

function clearRoomGrace(roomId: string) {
  const room = silentGrace.get(roomId);
  if (!room) return;
  for (const t of room.values()) clearTimeout(t);
  silentGrace.delete(roomId);
}

function clearAllGrace() {
  for (const room of silentGrace.values()) for (const t of room.values()) clearTimeout(t);
  silentGrace.clear();
}

/** The shared body of every confirmed departure, clean leave or
 *  silent expiry alike. REST is the identity authority: the relay
 *  event only SUGGESTS the departure; the registry confirms it
 *  before anyone is evicted or any key rotates. */
async function confirmDeparture(roomId: string, memberId: string, alias: string, line: string) {
  const session = getSession(roomId);
  if (!session) return;

  await useApp.getState().refreshMembers(roomId).catch(() => undefined);
  const stillMember = (useApp.getState().members[roomId] ?? []).some(
    (m) => m.memberId === memberId,
  );
  clearTyping(roomId, memberId);
  cancelGraceTimer(roomId, memberId);
  if (stillMember) return; // forged or racy: the "leaver" is still registered

  // Evict the leaver everywhere.
  useApp.setState((s) => ({
    members: {
      ...s.members,
      [roomId]: (s.members[roomId] ?? []).filter((m) => m.memberId !== memberId),
    },
  }));
  const cipher = getCipher(roomId);
  if (cipher) cipher.registry.delete(memberId);
  addSystemLine(roomId, line);

  // Those who stay re-seal the room: if this client is the
  // deterministic coordinator, generate a RANDOM new key and deliver
  // it pairwise over ECDH. The leaver never receives it: not through
  // the password, not through the wire.
  if (cipher && cipher.expectedCoordinator() === session.memberId) {
    const offerFrames = await cipher.rotateAsCoordinator();
    for (const f of offerFrames) {
      getRelay().emit("message:send", { roomId, envelope: f });
    }
    addSystemLine(roomId, "The room re-sealed for those who remain.");
  }
}

async function fireSilentEviction(roomId: string, memberId: string) {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher || session.memberId === memberId) return;

  const member = (useApp.getState().members[roomId] ?? []).find((m) => m.memberId === memberId);
  const registryEntry = cipher.registry.get(memberId);
  const okToAct = stillSilentAtExpiry({
    selfConnected: getRelay().connected,
    memberPresent: !!member && !!registryEntry,
    // The member's own connected STATE (false = quietly gone), not a
    // comparison result. The UI list and the cipher registry are kept
    // in sync by the same presence handler.
    memberConnected: member?.connected ?? registryEntry?.connected ?? true,
    isCoordinator: cipher.expectedCoordinator() === session.memberId,
  });
  if (!okToAct || !member) return;

  try {
    const res = await fetch(`/api/rooms/${roomId}/evict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId, callerId: session.memberId }),
    });
    if (!res.ok) return; // the server's facts disagreed; let it be

    // Announce to the room. Receivers REST-confirm before acting,
    // exactly as with member:left: the relay event carries no
    // authority of its own.
    getRelay().emit("member:expired", { roomId, memberId, alias: member.alias });
    // Our own emit does not echo back; run the confirmation locally.
    await confirmDeparture(roomId, memberId, member.alias, `${member.alias} drifted away.`);
  } catch {
    /* offline: the next unlock restarts the grace clock via room:state */
  }
}

function wireRelay(
  set: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void,
  get: () => AppState,
) {
  const relay = getRelay();

  relay.on("connect", () => {
    set({ relayOnline: true });
    for (const roomId of sessionRoomIds()) {
      const session = getSession(roomId);
      const cipher = getCipher(roomId);
      if (session && cipher) {
        relay.emit("room:join", {
          roomId,
          memberId: session.memberId,
          alias: session.alias,
          colorIdx: session.colorIdx,
          pubkey: cipher.sigPubJwk,
          ecdhPub: cipher.ecdh.pubRawB64,
          rejoined: true,
        });
      }
    }
  });

  relay.on("disconnect", () => {
    set({ relayOnline: false });
    // We cannot be the connection authority while offline ourselves;
    // the room:state after reconnect re-arms whatever still matters.
    clearAllGrace();
  });

  relay.on("room:state", ({ roomId, members }: { roomId: string; members: MemberPublic[] }) => {
    // The relay authenticates nothing: room:state only updates
    // PRESENCE. Identity (pubkeys, ECDH keys) comes exclusively from
    // the REST registry, which is keyed by pubkey and cannot be
    // poisoned by a forged join. (Adversarial review 19-10, finding 1.)
    //
    // The relay sees exactly who is live right now: registry members
    // absent from its list are OFFLINE (the away-dot after a
    // refresh), the starting point of the silent-departure grace.
    const liveIds = new Set(members.map((m) => m.memberId));
    set((s) => {
      const registry = s.members[roomId] ?? [];
      if (!registry.length) return {};
      return {
        members: {
          ...s.members,
          [roomId]: registry.map((m) => ({ ...m, connected: liveIds.has(m.memberId) })),
        },
      };
    });

    const cipher = getCipher(roomId);
    if (cipher) {
      for (const live of members) {
        const cur = cipher.registry.get(live.memberId);
        if (cur) cipher.registry.set(live.memberId, { ...cur, connected: true });
      }
      // Unknown members wait for the REST refresh that member:joined
      // triggers: a forged relay join never enters the registry.
      for (const [id, cur] of cipher.registry) {
        if (!liveIds.has(id)) {
          cipher.registry.set(id, { ...cur, connected: false });
          startGraceTimer(roomId, id);
        }
      }
    }
  });

  relay.on(
    "member:joined",
    async ({ roomId, member, rejoined }: { roomId: string; member: MemberPublic; rejoined?: boolean }) => {
      const session = getSession(roomId);
      if (!session) return;

      // The relay join broadcast carries NO authentication; key
      // material from it is never trusted. The REST registry (keyed by
      // pubkey, so a forged memberId cannot overwrite a real member)
      // is the only identity authority: refresh from it, then act on
      // what it confirms. (Adversarial review 19-10, finding 1.)
      await get().refreshMembers(roomId).catch(() => undefined);
      const confirmed = (useApp.getState().members[roomId] ?? []).find(
        (m) => m.memberId === member.memberId,
      );
      if (!confirmed) {
        return; // forged or unconfirmed join: no registry entry, no key
      }

      set((s) => ({
        members: {
          ...s.members,
          [roomId]: (s.members[roomId] ?? []).map((m) =>
            m.memberId === confirmed.memberId ? { ...m, connected: true } : m,
          ),
        },
      }));

      const cipher = getCipher(roomId);
      if (cipher && confirmed.ecdhPub) {
        const cur = cipher.registry.get(confirmed.memberId);
        cipher.registry.set(confirmed.memberId, {
          pubkey: confirmed.pubkey,
          ecdhPubB64: confirmed.ecdhPub ?? cur?.ecdhPubB64,
          connected: true,
          joinedAt: confirmed.joinedAt ?? cur?.joinedAt,
          alias: confirmed.alias,
          colorIdx: confirmed.colorIdx,
        });
        // If the room has rotated past the password-derived key, hand
        // the newcomer the CURRENT key, ECDH-wrapped and sealed under
        // the entry key, so only a joiner who proved the password can
        // open it. Every member sends; the joiner keeps the highest.
        if (cipher.kv > 1 && confirmed.memberId !== session.memberId) {
          void cipher.deliverKeyTo(confirmed.memberId).then((frames) => {
            for (const f of frames) {
              relay.emit("message:send", { roomId, envelope: f });
            }
          });
        }
      }
      if (confirmed.memberId !== session.memberId) {
        addSystemLine(roomId, rejoined ? `${confirmed.alias} returned.` : `${confirmed.alias} joined.`);
        touchCard(roomId, get().activeRoomId !== roomId);
      }
      // A return within the grace window cancels any pending
      // silent-eviction clock for them.
      cancelGraceTimer(roomId, member.memberId);
    },
  );

  relay.on(
    "member:presence",
    ({ roomId, memberId, connected }: { roomId: string; memberId: string; connected: boolean }) => {
      set((s) => ({
        members: {
          ...s.members,
          [roomId]: (s.members[roomId] ?? []).map((m) =>
            m.memberId === memberId ? { ...m, connected } : m,
          ),
        },
      }));
      const cipher = getCipher(roomId);
      if (cipher) {
        const cur = cipher.registry.get(memberId);
        if (cur) cipher.registry.set(memberId, { ...cur, connected });
      }
      // Connected again: the grace clock for this member stops.
      // Quietly gone: it starts (never for ourselves: our own
      // disconnects are visible to us, not departures).
      if (connected) cancelGraceTimer(roomId, memberId);
      else startGraceTimer(roomId, memberId);
    },
  );

  relay.on(
    "member:left",
    async ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session) return;
      // The relay event is unauthenticated. confirmDeparture()
      // re-checks the REST registry before evicting or rotating, so a
      // forged member:left cannot force a rotation or evict a live
      // member. (Adversarial review 19-10, finding 2.)
      await confirmDeparture(roomId, memberId, alias, `${alias} left.`);
    },
  );

  // A silent leaver was written out server-side (the coordinator's
  // grace-expired eviction). Same rule as member:left: the relay
  // event suggests, the registry confirms.
  relay.on(
    "member:expired",
    async ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session) return;
      await confirmDeparture(roomId, memberId, alias, `${alias} drifted away.`);
    },
  );

  relay.on("message:ack", ({ id, roomId }: { id: string; roomId?: string }) => {
    const target = roomId ?? get().activeRoomId;
    if (!target) return;
    patchView(target, id, { status: "sent" });
  });

  // NOTE: the legacy `message:spent` relay event is intentionally NOT
  // handled anymore: it carried no authentication, so anyone who knew
  // the room id could spoil view-once files for everyone. v2 clients
  // spend via cipher-verified encrypted frames. (Review 19-10, finding 3.)

  // Legacy early-burn announces from pre-upgrade clients.
  relay.on(
    "message:burn",
    async ({
      roomId,
      messageId,
      senderId,
      sig,
    }: {
      roomId: string;
      messageId: string;
      senderId?: string;
      sig?: string;
    }) => {
      const session = getSession(roomId);
      if (!session || !senderId) return;
      const target = (useApp.getState().messages[roomId] ?? []).find(
        (m) => m.id === messageId,
      );
      if (!target || target.kind === "system") return;

      const registry = useApp.getState().members[roomId] ?? [];
      const author = registry.find((m) => m.memberId === senderId);
      const ok =
        !!author?.pubkey &&
        !!sig &&
        target.senderId === senderId &&
        (await verifyCanonical(author.pubkey, ["v1", "burn", roomId, senderId, messageId].join("|"), sig));
      if (!ok) {
        addSystemLine(
          roomId,
          `A burn request claiming to be from ${author?.alias ?? "an unknown member"} was rejected - signature invalid.`,
        );
        return;
      }
      const t = burnTimers.get(messageId);
      if (t) {
        clearTimeout(t);
        burnTimers.delete(messageId);
      }
      onMessageBurn(roomId, messageId);
    },
  );

  relay.on("room:burned", ({ roomId }: { roomId: string }) => {
    const session = getSession(roomId);
    if (!session) return;
    clearRoomGrace(roomId);
    set({ burn: { roomId } });
  });

  relay.on(
    "message:new",
    async ({ roomId, envelope }: { roomId: string; envelope: WireFrame | WireEnvelope }) => {
      const session = getSession(roomId);
      if (!session || !envelope) return;

      if ((envelope as WireFrame).v === 2) {
        await receiveFrame(roomId, envelope as WireFrame);
        return;
      }
      // v1 envelopes only decode in v1 rooms; a v2 room accepting
      // them would let any password-holder bypass replay defense,
      // uniform padding and the registry gate. (Review 19-10, finding 4.)
      if (!session.legacy) return;
      await receiveLegacyEnvelope(roomId, envelope as WireEnvelope);
    },
  );

  // Legacy typing whispers from pre-upgrade clients: display only,
  // and only for senders the REST registry actually knows.
  relay.on(
    "member:typing",
    ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session || memberId === session.memberId) return;
      const known = (useApp.getState().members[roomId] ?? []).some(
        (m) => m.memberId === memberId,
      );
      if (!known) return;
      useApp.setState((s) => {
        const list = (s.typing[roomId] ?? []).filter((t) => t.memberId !== memberId);
        return {
          typing: { ...s.typing, [roomId]: [...list, { memberId, alias, at: Date.now() }] },
        };
      });
      pruneTypingLater(roomId);
    },
  );

  // A member who is stuck on an old key version asks for delivery.
  // Answer with the current key, wrapped so only password-holders
  // can open it. (Relay rate-limits these.)
  relay.on("key:request", ({ roomId, from }: { roomId: string; from: string }) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher || cipher.kv <= 1) return;
    if (from === session.memberId) return;
    if (!cipher.registry.has(from)) return;
    void cipher.deliverKeyTo(from).then((frames) => {
      for (const f of frames) {
        relay.emit("message:send", { roomId, envelope: f });
      }
    });
  });
}

/* ------------------------------------------------------------------
   v2 receive path: every security decision lives in the cipher
   ------------------------------------------------------------------ */

async function receiveFrame(roomId: string, frame: WireFrame) {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher) return;

  const result = await cipher.open(frame);
  await handleOpenResult(roomId, frame, result);

  // A frame we could not yet decrypt may mean we are a joiner (or a
  // reconnecter) waiting for key delivery; ask for it, quietly.
  if (result.type === "pending" && cipher.kv === 1) {
    const now = Date.now();
    const last = keyReqLastEmit.get(roomId) ?? 0;
    if (now - last > KEYREQ_THROTTLE_MS) {
      keyReqLastEmit.set(roomId, now);
      getRelay().emit("key:request", { roomId, from: session.memberId });
      setResealing(roomId, true);
    }
  }
}

async function handleOpenResult(roomId: string, frame: WireFrame, result: OpenResult) {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher) return;
  const registry = useApp.getState().members[roomId] ?? [];
  const inRoom = useApp.getState().activeRoomId === roomId;

  switch (result.type) {
    case "text": {
      const sender = registry.find((m) => m.memberId === result.body.senderId);
      if (!sender) return;
      const ttlSec = result.body.ttlSec;
      const view: MessageView = {
        id: frame.id,
        kind: "text",
        senderId: sender.memberId,
        senderAlias: sender.alias,
        senderColor: sender.colorIdx,
        self: sender.memberId === session.memberId,
        status: "sent",
        ts: result.body.ts,
        text: result.body.text ?? "",
        replyTo: sanitizeReplySnapshot(result.body.reply),
        ttlSec,
        expiresAt: ttlSec ? result.body.ts + ttlSec * 1000 : undefined,
      };
      useApp.setState((s) => ({
        messages: {
          ...s.messages,
          [roomId]: [...(s.messages[roomId] ?? []), view],
        },
      }));
      clearTyping(roomId, sender.memberId);
      touchCard(roomId, !inRoom, 1);
      // A letter for a room the user isn't looking at rises as a
      // notice: banner while the app is open, system notification
      // while it's hidden. What it says follows the preview setting.
      if (!view.self && !inRoom) {
        notifyIncoming({
          roomId,
          roomName: roomNameOf(roomId),
          alias: sender.alias,
          colorIdx: sender.colorIdx,
          text: view.text,
        });
      }
      if (view.expiresAt) {
        scheduleBurn(roomId, view.id, view.expiresAt, onMessageBurn);
      }
      return;
    }

    case "typing": {
      if (result.senderId === session.memberId) return;
      const sender = registry.find((m) => m.memberId === result.senderId);
      useApp.setState((s) => {
        const list = (s.typing[roomId] ?? []).filter((t) => t.memberId !== result.senderId);
        return {
          typing: {
            ...s.typing,
            [roomId]: [
              ...list,
              { memberId: result.senderId, alias: sender?.alias ?? "Someone", at: Date.now() },
            ],
          },
        };
      });
      pruneTypingLater(roomId);
      return;
    }

    case "spent": {
      patchView(roomId, result.messageId, { spent: true });
      return;
    }

    case "react": {
      // A margin mark on a message. If the target is gone (expired, or
      // sent before this member joined), the mark simply has nothing
      // to annotate: quietly ignored.
      clearTyping(roomId, result.senderId);
      useApp.setState((s) => ({
        messages: {
          ...s.messages,
          [roomId]: applyMarkToggle(
            s.messages[roomId] ?? [],
            result.messageId,
            result.senderId,
            result.mark as ReactionMark,
          ),
        },
      }));
      return;
    }

    case "burn": {
      const target = (useApp.getState().messages[roomId] ?? []).find(
        (m) => m.id === result.messageId,
      );
      // The cipher already verified the author's signature; make sure
      // the target is actually the author's own letter.
      if (!target || target.kind === "system" || target.senderId !== result.senderId) return;
      const t = burnTimers.get(result.messageId);
      if (t) {
        clearTimeout(t);
        burnTimers.delete(result.messageId);
      }
      onMessageBurn(roomId, result.messageId);
      return;
    }

    case "file": {
      const sender = registry.find((m) => m.memberId === result.senderId);
      if (!sender) return;
      const view: MessageView = {
        id: result.file.messageId,
        kind: "file",
        senderId: sender.memberId,
        senderAlias: sender.alias,
        senderColor: sender.colorIdx,
        self: sender.memberId === session.memberId,
        status: "sent",
        ts: result.ts,
        text: result.text,
        replyTo: sanitizeReplySnapshot(result.reply),
        file: {
          name: result.file.name,
          mime: result.file.mime,
          size: result.file.size,
          dataB64: result.file.dataB64,
        },
        ttlSec: result.file.ttlSec,
        expiresAt: result.file.ttlSec ? result.ts + result.file.ttlSec * 1000 : undefined,
        viewOnce: result.file.viewOnce,
      };
      useApp.setState((s) => ({
        messages: {
          ...s.messages,
          [roomId]: [...(s.messages[roomId] ?? []), view],
        },
      }));
      clearTyping(roomId, sender.memberId);
      touchCard(roomId, !inRoom, 1);
      if (!view.self && !inRoom) {
        notifyIncoming({
          roomId,
          roomName: roomNameOf(roomId),
          alias: sender.alias,
          colorIdx: sender.colorIdx,
          text: result.text,
          isFile: true,
        });
      }
      if (view.expiresAt) {
        scheduleBurn(roomId, view.id, view.expiresAt, onMessageBurn);
      }
      return;
    }

    case "file-meta":
    case "file-chunk":
      return; // assembly happens inside the cipher; render on completion

    case "offer-installed": {
      session.kv = cipher.kv;
      setResealing(roomId, false);
      if (result.rotation) {
        addSystemLine(roomId, "The room re-sealed for those who remain.");
      }
      // Frames that were parked waiting for this key.
      const drained = await cipher.drainPending();
      for (const { frame: parked, result: r } of drained) {
        await handleOpenResult(roomId, parked, r).catch(() => undefined);
      }
      return;
    }

    case "pending":
      return;

    case "reject": {
      if (result.reason === "signature") {
        const sender = registry.find((m) => m.memberId === frame.from);
        addSystemLine(
          roomId,
          `A message claiming to be from ${sender?.alias ?? "an unknown member"} was rejected - signature invalid.`,
        );
        touchCard(roomId, !inRoom);
      }
      // Other rejections (replay, registry, kv, shape) are silent;
      // they are the protocol defending itself, not user-actionable.
      return;
    }
  }
}

/* ------------ legacy envelope id dedup (v1 rooms only) ------------ */
const legacySeen = new Set<string>();
const legacySeenOrder: string[] = [];

function legacySeenOnce(id: string): boolean {
  if (legacySeen.has(id)) return false;
  legacySeen.add(id);
  legacySeenOrder.push(id);
  if (legacySeenOrder.length > 1024) {
    const drop = legacySeenOrder.splice(0, legacySeenOrder.length - 1024);
    for (const d of drop) legacySeen.delete(d);
  }
  return true;
}

/* ------------------------------------------------------------------
   Legacy receive path: rooms created before protocol v2
   ------------------------------------------------------------------ */

async function receiveLegacyEnvelope(roomId: string, envelope: WireEnvelope) {
  const session = getSession(roomId);
  if (!session || !session.legacy || !envelope) return;
  if (envelope.id && !legacySeenOnce(envelope.id)) return; // duplicate

  let payload: Payload | null = null;
  try {
    const { getEpochKeyLegacy } = await import("@/lib/legacy");
    const key = await getEpochKeyLegacy(roomId, envelope.epoch, session.password);
    payload = await decryptJson<Payload>(key, envelope.iv, envelope.ct);
  } catch {
    payload = null;
  }

  const registry = useApp.getState().members[roomId] ?? [];
  const sender = registry.find((m) => m.memberId === envelope.senderId);

  if (!payload || !sender) {
    addSystemLine(
      roomId,
      `A message claiming to be from ${sender?.alias ?? "an unknown member"} was rejected - signature invalid.`,
    );
    touchCard(roomId, useApp.getState().activeRoomId !== roomId);
    return;
  }

  const canonical = canonicalFor({
    roomId,
    epoch: envelope.epoch,
    senderId: envelope.senderId,
    ts: payload.ts,
    kind: envelope.kind,
    text: payload.text,
    fileSha: payload.file?.sha,
  });
  const ok = await verifyCanonical(sender.pubkey, canonical, payload.sig);
  if (!ok) {
    addSystemLine(
      roomId,
      `A message claiming to be from ${sender.alias} was rejected - signature invalid.`,
    );
    touchCard(roomId, useApp.getState().activeRoomId !== roomId);
    return;
  }

  const view: MessageView = {
    id: envelope.id,
    kind: envelope.kind,
    senderId: sender.memberId,
    senderAlias: sender.alias,
    senderColor: sender.colorIdx,
    self: sender.memberId === session.memberId,
    status: "sent",
    ts: payload.ts,
    text: payload.text,
    file: payload.file
      ? {
          name: payload.file.name,
          mime: payload.file.mime,
          size: payload.file.size,
          dataB64: payload.file.dataB64,
        }
      : undefined,
    ttlSec: envelope.ttlSec,
    expiresAt: envelope.ttlSec ? payload.ts + envelope.ttlSec * 1000 : undefined,
    viewOnce: envelope.viewOnce,
  };
  useApp.setState((s) => ({
    messages: {
      ...s.messages,
      [roomId]: [...(s.messages[roomId] ?? []), view],
    },
  }));
  clearTyping(roomId, sender.memberId);
  touchCard(roomId, useApp.getState().activeRoomId !== roomId, 1);
  if (view.expiresAt) {
    scheduleBurn(roomId, view.id, view.expiresAt, onMessageBurn);
  }
}
