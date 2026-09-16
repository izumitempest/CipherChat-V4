// The application store. One place owns: the desk (room cards),
// per-room message memory, member registries, the relay wiring, and
// the choreography of enter / unlock / send / burn.

import { create } from "zustand";
import type {
  MessageView,
  RoomCard,
  Screen,
  TtlChoice,
  WireEnvelope,
  Payload,
  MemberPublic,
  FilePayload,
} from "@/lib/types";
import {
  loadDeviceIdentity,
  signCanonical,
  verifyCanonical,
  canonicalFor,
  burnCanonical,
  encryptJson,
  decryptJson,
  makeVerifier,
  checkVerifier,
  sha256HexOfBytes,
  fromB64,
  type DeviceIdentity,
} from "@/lib/crypto";
import { aliasFromFingerprint, inkFromFingerprint } from "@/lib/identity";
import {
  getSession,
  setSession,
  dropSession,
  sessionRoomIds,
  getEpochKey,
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
} from "@/lib/local";
import { getRelay } from "@/lib/relay";

export const FILE_LIMIT = 2 * 1024 * 1024; // 2 MB — nothing is stored anywhere

export interface SealingState {
  roomId: string;
  label: string;
}

export interface JoinResult {
  ok: boolean;
  reason?: "wrong-password" | "not-found" | "burned" | "room-full" | "error";
}

/** Someone is writing — transient, expires by its own clock. */
export interface TypingSignal {
  memberId: string;
  alias: string;
  at: number;
}

interface AppState {
  ready: boolean;
  device: DeviceIdentity | null;
  screen: Screen;
  activeRoomId: string | null;
  inviteCode: string | null;

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
  createRoom: (localName: string, password: string) => Promise<JoinResult>;
  joinRoom: (code: string, password: string, localName?: string) => Promise<JoinResult>;
  enterRoom: (session: RoomSession, localName: string, rejoined: boolean) => Promise<void>;
  sendMessage: (
    text: string,
    file?: Omit<FilePayload, "sha"> & { viewOnce?: boolean },
    ttlOverride?: TtlChoice,
  ) => Promise<void>;
  emitTyping: (roomId: string) => void;
  spendViewOnce: (roomId: string, messageId: string) => void;
  burnMessage: (roomId: string, messageId: string) => Promise<void>;
  burnRoom: (roomId: string) => Promise<void>;
  finishRoomBurn: (roomId: string) => void;
  leaveRoom: (roomId: string) => Promise<void>;
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

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  device: null,
  screen: "landing",
  activeRoomId: null,
  inviteCode: null,

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
    if (get().ready) return;
    const device = await loadDeviceIdentity();
    // Burned rooms showed their ash last session; now they are gone.
    const cards = sweepBurnedRooms();
    set({ device, roomCards: cards, ready: true });

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
        patchRoomCard(roomId, { unread: false });
        set({ roomCards: loadRoomCards() });
      }
      // No keys in memory — the room is locked. A first-class state,
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

  createRoom: async (localName, password) => {
    const device = get().device;
    if (!device) return { ok: false, reason: "error" };

    const res = await fetch("/api/rooms", { method: "POST" });
    if (!res.ok) return { ok: false, reason: "error" };
    const { roomId, creatorToken } = await res.json();
    saveCreatorToken(roomId, creatorToken);

    set({ sealing: { roomId, label: "Sealing the room" } });
    const started = Date.now();

    const { deriveRoomKey } = await import("@/lib/crypto");
    const key = await deriveRoomKey(roomId, 1, password);
    const verifier = await makeVerifier(key);
    await Promise.all([
      fetch(`/api/rooms/${roomId}/verifier`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifier }),
      }),
      new Promise((r) => setTimeout(r, MIN_SEAL_MS - (Date.now() - started))),
    ]);

    const alias = aliasFromFingerprint(device.fingerprintHex);
    const colorIdx = inkFromFingerprint(device.fingerprintHex);
    const joinRes = await fetch(`/api/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: device.pubJwk, alias, colorIdx }),
    });
    if (!joinRes.ok) {
      set({ sealing: null });
      return { ok: false, reason: "error" };
    }
    const { memberId } = await joinRes.json();

    const session: RoomSession = {
      roomId,
      memberId,
      alias,
      colorIdx,
      epoch: 1,
      password,
      creatorToken,
      defaultTtl: loadRoomSettings(roomId).defaultTtl,
      keys: new Map([[1, key]]),
      pending: new Map(),
    };
    setSession(session);
    set({ sealing: null });
    await get().enterRoom(session, localName || "New room", false);
    return { ok: true };
  },

  /* ------------------------------------------------- join ---- */

  joinRoom: async (code, password, localName) => {
    const device = get().device;
    if (!device) return { ok: false, reason: "error" };

    const infoRes = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    if (!infoRes.ok) {
      const info = await infoRes.json().catch(() => ({}));
      return {
        ok: false,
        reason: info?.burned ? "burned" : "not-found",
      };
    }
    const info = await infoRes.json();
    if (info.memberCount >= info.memberCap) {
      return { ok: false, reason: "room-full" };
    }

    const { deriveRoomKey } = await import("@/lib/crypto");
    set({ sealing: { roomId: code, label: "Sealing the room" } });
    const started = Date.now();
    const key = await deriveRoomKey(code, info.epoch, password);
    const verified = info.verifier ? await checkVerifier(key, info.verifier) : true;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, MIN_SEAL_MS - (Date.now() - started))),
    );

    if (!verified) {
      set({ sealing: null });
      return { ok: false, reason: "wrong-password" };
    }

    const alias = aliasFromFingerprint(device.fingerprintHex);
    const colorIdx = inkFromFingerprint(device.fingerprintHex);
    const joinRes = await fetch(`/api/rooms/${code}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: device.pubJwk, alias, colorIdx }),
    });
    if (!joinRes.ok) {
      set({ sealing: null });
      if (joinRes.status === 403) return { ok: false, reason: "room-full" };
      return { ok: false, reason: "error" };
    }
    const { memberId, epoch, rejoined } = await joinRes.json();

    const session: RoomSession = {
      roomId: code,
      memberId,
      alias,
      colorIdx,
      epoch,
      password,
      creatorToken: loadCreatorToken(code),
      defaultTtl: loadRoomSettings(code).defaultTtl,
      keys: new Map([[epoch, key]]),
      pending: new Map(),
    };
    setSession(session);
    set({ sealing: null });
    const name =
      localName ||
      get().roomCards.find((c) => c.roomId === code)?.localName ||
      `Room ${code.slice(0, 4)}`;
    await get().enterRoom(session, name, !!rejoined);
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
      burned: false,
      locked: false,
    });
    set({ roomCards: loadRoomCards() });

    // Fresh message memory — there is no backlog, ever.
    set((s) => ({ messages: { ...s.messages, [session.roomId]: [] } }));

    await get().refreshMembers(session.roomId);

    const device = get().device;
    const relay = getRelay();
    relay.emit("room:join", {
      roomId: session.roomId,
      memberId: session.memberId,
      alias: session.alias,
      colorIdx: session.colorIdx,
      pubkey: device?.pubJwk,
      rejoined,
    });
    set({ relayOnline: relay.connected });

    get().navigate("chat", session.roomId);
  },

  refreshMembers: async (roomId) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`);
      if (!res.ok) return;
      const { members } = await res.json();
      set((s) => ({ members: { ...s.members, [roomId]: members } }));
    } catch {
      /* offline — the registry stays as-is */
    }
  },

  /* ------------------------------------------------- send ---- */

  sendMessage: async (text, file, ttlOverride) => {
    const viewOnce = !!file?.viewOnce;
    const { activeRoomId, device } = get();
    if (!activeRoomId || !device) return;
    const session = getSession(activeRoomId);
    if (!session) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;

    const id = crypto.randomUUID();
    const ts = Date.now();
    const kind = file ? "file" : "text";
    let fileSha: string | undefined;
    let fullFile: FilePayload | undefined;
    if (file) {
      fileSha = await sha256HexOfBytes(fromB64(file.dataB64));
      fullFile = { ...file, sha: fileSha };
    }

    const canonical = canonicalFor({
      roomId: session.roomId,
      epoch: session.epoch,
      senderId: session.memberId,
      ts,
      kind,
      text: trimmed,
      fileSha,
    });
    const sig = await signCanonical(device.privJwk, canonical);
    const payload: Payload = {
      text: trimmed,
      ts,
      senderId: session.memberId,
      sig,
      kind,
      file: fullFile,
    };

    const key = await getEpochKey(session, session.epoch);
    const { iv, ct } = await encryptJson(key, payload);

    const ttlSec = (ttlOverride !== undefined ? ttlOverride : session.defaultTtl) || undefined;
    const envelope: WireEnvelope = {
      id,
      roomId: session.roomId,
      epoch: session.epoch,
      senderId: session.memberId,
      ts,
      iv,
      ct,
      ttlSec,
      viewOnce: file && viewOnce ? true : undefined,
      kind,
    };

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

    getRelay().emit("message:send", { roomId: session.roomId, envelope });
  },

  /* --------------------------------------------- typing ------- */

  emitTyping: (roomId) => {
    const session = getSession(roomId);
    if (!session) return;
    const now = Date.now();
    const last = typingLastEmit.get(roomId) ?? 0;
    if (now - last < TYPING_EMIT_THROTTLE_MS) return;
    typingLastEmit.set(roomId, now);
    getRelay().emit("member:typing", {
      roomId,
      memberId: session.memberId,
      alias: session.alias,
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
    getRelay().emit("message:spent", { roomId, messageId });
  },

  /* --------------------------------------------- burn-one ---- */

  /** Retire one of your own letters ahead of its clock. The announce
   *  is signed, so only the author can do this — nobody else can
   *  burn a message they did not write. */
  burnMessage: async (roomId, messageId) => {
    const { activeRoomId, device } = get();
    if (!device) return;
    const target = roomId ?? activeRoomId;
    const session = getSession(target);
    const msg = (get().messages[target] ?? []).find((m) => m.id === messageId);
    if (!session || !msg || !msg.self || msg.kind === "system") return;

    const sig = await signCanonical(
      device.privJwk,
      burnCanonical(target, session.memberId, messageId),
    );
    getRelay().emit("message:burn", {
      roomId: target,
      messageId,
      senderId: session.memberId,
      sig,
    });

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
    patchRoomCard(roomId, { burned: true, unread: false, lastActivity: Date.now() });
    set((s) => ({
      burn: null,
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: { ...s.messages, [roomId]: [] },
    }));
    get().navigate("rooms");
  },

  /* ------------------------------------------------- leave --- */

  leaveRoom: async (roomId) => {
    const session = getSession(roomId);
    if (session) {
      try {
        await fetch(`/api/rooms/${roomId}/leave`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberId: session.memberId }),
        });
      } catch {
        /* best effort — the epoch bump happens server-side anyway */
      }
      getRelay().emit("member:leave", {
        roomId,
        memberId: session.memberId,
        alias: session.alias,
      });
    }
    const messages = get().messages[roomId] ?? [];
    cancelBurns(roomId, messages);
    dropSession(roomId);
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
   Relay wiring — one socket, registered once, drives the whole house
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

function touchCard(roomId: string, unread: boolean) {
  patchRoomCard(roomId, { lastActivity: Date.now(), unread });
  useApp.setState({ roomCards: loadRoomCards() });
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
    const device = useApp.getState().device;
    for (const roomId of sessionRoomIds()) {
      const session = getSession(roomId);
      if (session) {
        relay.emit("room:join", {
          roomId,
          memberId: session.memberId,
          alias: session.alias,
          colorIdx: session.colorIdx,
          pubkey: device?.pubJwk,
          rejoined: true,
        });
      }
    }
  });

  relay.on("disconnect", () => set({ relayOnline: false }));

  relay.on("room:state", ({ roomId, members }: { roomId: string; members: MemberPublic[] }) => {
    // merge live presence into the registry
    const registry = useApp.getState().members[roomId] ?? [];
    const byId = new Map(registry.map((m) => [m.memberId, { ...m }]));
    for (const live of members) {
      const existing = byId.get(live.memberId);
      byId.set(live.memberId, {
        ...live,
        ...(existing?.pubkey ? { pubkey: existing.pubkey } : {}),
      });
    }
    set((s) => ({ members: { ...s.members, [roomId]: Array.from(byId.values()) } }));
  });

  relay.on(
    "member:joined",
    ({ roomId, member, rejoined }: { roomId: string; member: MemberPublic; rejoined?: boolean }) => {
      const session = getSession(roomId);
      if (!session) return;
      set((s) => {
        const registry = s.members[roomId] ?? [];
        if (registry.some((m) => m.memberId === member.memberId)) {
          return {
            members: {
              ...s.members,
              [roomId]: registry.map((m) =>
                m.memberId === member.memberId ? { ...m, connected: true } : m,
              ),
            },
          };
        }
        return {
          members: { ...s.members, [roomId]: [...registry, { ...member, connected: true }] },
        };
      });
      if (member.memberId !== session.memberId) {
        addSystemLine(roomId, rejoined ? `${member.alias} returned.` : `${member.alias} joined.`);
        touchCard(roomId, get().activeRoomId !== roomId);
      }
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
    },
  );

  relay.on(
    "member:left",
    async ({ roomId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session) return;
      addSystemLine(roomId, `${alias} left. The room key was rotated.`);
      // Rotate: fetch the new epoch and re-derive quietly.
      set((s) => ({ resealing: { ...s.resealing, [roomId]: true } }));
      try {
        const res = await fetch(`/api/rooms/${roomId}`);
        if (res.ok) {
          const info = await res.json();
          session.epoch = info.epoch;
          await getEpochKey(session, info.epoch);
        }
      } finally {
        set((s) => {
          const next = { ...s.resealing };
          delete next[roomId];
          return { resealing: next };
        });
      }
      get().refreshMembers(roomId);
    },
  );

  relay.on("message:ack", ({ id, roomId }: { id: string; roomId?: string }) => {
    const target = roomId ?? get().activeRoomId;
    if (!target) return;
    patchView(target, id, { status: "sent" });
  });

  relay.on("message:spent", ({ roomId, messageId }: { roomId: string; messageId: string }) => {
    patchView(roomId, messageId, { spent: true });
  });

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
        (await verifyCanonical(author.pubkey, burnCanonical(roomId, senderId, messageId), sig));
      if (!ok) {
        addSystemLine(
          roomId,
          `A burn request claiming to be from ${author?.alias ?? "an unknown member"} was rejected — signature invalid.`,
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
    set({ burn: { roomId } });
  });

  relay.on(
    "message:new",
    async ({ roomId, envelope }: { roomId: string; envelope: WireEnvelope }) => {
      const session = getSession(roomId);
      if (!session || !envelope) return;

      // Might need a key for a newer epoch (quiet re-seal)
      set((s) => ({ resealing: { ...s.resealing, [roomId]: true } }));
      let payload: Payload | null = null;
      try {
        const key = await getEpochKey(session, envelope.epoch);
        payload = await decryptJson<Payload>(key, envelope.iv, envelope.ct);
      } catch {
        payload = null;
      } finally {
        set((s) => {
          const next = { ...s.resealing };
          delete next[roomId];
          return { resealing: next };
        });
      }

      const registry = get().members[roomId] ?? [];
      const sender = registry.find((m) => m.memberId === envelope.senderId);

      if (!payload || !sender) {
        // Tampered, undecryptable, or from an unknown member: rejected.
        addSystemLine(
          roomId,
          `A message claiming to be from ${sender?.alias ?? "an unknown member"} was rejected — signature invalid.`,
        );
        touchCard(roomId, get().activeRoomId !== roomId);
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
          `A message claiming to be from ${sender.alias} was rejected — signature invalid.`,
        );
        touchCard(roomId, get().activeRoomId !== roomId);
        return;
      }

      if (envelope.epoch > session.epoch) session.epoch = envelope.epoch;

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
      // The message arrived — the whisper is over.
      clearTyping(roomId, sender.memberId);
      touchCard(roomId, get().activeRoomId !== roomId);
      if (view.expiresAt) {
        scheduleBurn(roomId, view.id, view.expiresAt, onMessageBurn);
      }
    },
  );

  relay.on(
    "member:typing",
    ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session || memberId === session.memberId) return;
      useApp.setState((s) => {
        const list = (s.typing[roomId] ?? []).filter((t) => t.memberId !== memberId);
        return {
          typing: { ...s.typing, [roomId]: [...list, { memberId, alias, at: Date.now() }] },
        };
      });
      pruneTypingLater(roomId);
    },
  );
}
