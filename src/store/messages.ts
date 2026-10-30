// The message memory: what the room keeps in plain text, and the
// rules that keep it bounded.
//
// Three things live here, all of them pure functions over plain
// arrays and maps:
//
//   1. the message list per room, capped. A room that sits for a day
//      keeps a finite number of letters, not every letter ever sent.
//   2. the file payloads, kept OUT of the message list. A message
//      names its file; the bytes live in a separate map under a byte
//      budget. The list stays light, the DOM stays light, and the
//      memory is bounded.
//   3. the shared edits: the mark toggle, the patch, the burn.
//
// The rules are here, not in the components, so a test can hold them
// to account without a browser.

import { sha256HexOfBytes, fromB64 } from "@/lib/crypto";
import { loadRoomCards, patchRoomCard } from "@/lib/local";
import { getRelay } from "@/lib/relay";
import { getCipher } from "@/lib/room-protocol";
import { getSession } from "@/lib/session";
import { isReactionMark, type MessageView, type ReactionMark } from "@/lib/types";
import type { WireFrame } from "@/lib/protocol";
import { cancelBurnTimer, scheduleBurn } from "@/store/timers";
import type { AppSlice, StoreSet } from "@/store/types";

/** How many letters a room keeps in memory. The oldest go when the
 *  cap is reached. */
export const MESSAGE_CAP = 500;

/** How many bytes of file payload a room keeps. The oldest file goes
 *  when the budget is reached; its message stays, without the bytes,
 *  and says so. 32 MB is about sixteen maximum-size files. */
export const FILE_PAYLOAD_BUDGET = 32 * 1024 * 1024;

/** One file's bytes, and the room they belong to. */
export interface FilePayloadEntry {
  roomId: string;
  dataB64: string;
}

/** The file payloads of every room, keyed by the message id that
 *  names the file. The key is the message id, so a card can find its
 *  bytes without knowing the room. */
export type PayloadStore = Record<string, FilePayloadEntry>;

/** Append a letter, and keep the list inside its cap. The oldest
 *  letter is dropped when the cap is reached. */
export function appendMessage(
  list: MessageView[],
  view: MessageView,
  cap: number = MESSAGE_CAP,
): MessageView[] {
  const next = [...list, view];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Put a letter in a room's memory, with its file bytes when it has
 *  any. The list stays inside its cap, and a letter the cap pushed
 *  out takes its file with it: nothing outlives its message. */
export function appendToRoom(
  set: StoreSet,
  roomId: string,
  view: MessageView,
  dataB64?: string,
): void {
  set((s) => {
    const list = s.messages[roomId] ?? [];
    const next = appendMessage(list, view);
    let payloads = dataB64
      ? putPayload(s.filePayloads, roomId, view.id, dataB64)
      : s.filePayloads;
    const kept = new Set(next.map((m) => m.id));
    for (const id of Object.keys(payloads)) {
      if (payloads[id].roomId === roomId && !kept.has(id)) {
        payloads = dropPayload(payloads, roomId, id);
      }
    }
    return {
      messages: { ...s.messages, [roomId]: next },
      filePayloads: payloads,
    };
  });
}

/** Patch one letter. A letter that is not there stays not there. */
export function patchMessage(
  list: MessageView[],
  messageId: string,
  patch: Partial<MessageView>,
): MessageView[] {
  return list.map((m) => (m.id === messageId ? { ...m, ...patch } : m));
}

/** Take one letter out. */
export function removeMessage(list: MessageView[], messageId: string): MessageView[] {
  return list.filter((m) => m.id !== messageId);
}

/** The single transition rule for ink marks: setting a mark you already
 *  hold clears it; setting a different one moves yours; each sender holds
 *  at most one mark per message. Applied identically by the optimistic
 *  local update and by every receiver, so the frames converge. */
export function applyMarkToggle(
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

/** The bytes a payload costs, counted as the base64 string holds
 *  them. */
function payloadBytes(dataB64: string): number {
  return dataB64.length;
}

/** Keep a file's bytes, and keep the room's file bytes inside the
 *  budget. The oldest file goes first when the budget is reached; its
 *  message stays in the list and says the bytes are gone. */
export function putPayload(
  store: PayloadStore,
  roomId: string,
  messageId: string,
  dataB64: string,
  budget: number = FILE_PAYLOAD_BUDGET,
): PayloadStore {
  const next: PayloadStore = { ...store, [messageId]: { roomId, dataB64 } };
  // The room's own files, oldest first: the order the files arrived
  // in. The one just added is never the one that goes.
  const roomFiles = Object.keys(next).filter((id) => next[id].roomId === roomId);
  let used = roomFiles.reduce((sum, id) => sum + payloadBytes(next[id].dataB64), 0);
  for (const id of roomFiles) {
    if (used <= budget) break;
    if (id === messageId) continue; // never drop the one just added
    used -= payloadBytes(next[id].dataB64);
    delete next[id];
  }
  // A single file bigger than the whole budget is kept anyway: it is
  // the file the reader is about to open, and dropping it would make
  // the message a lie.
  return next;
}

/** Take a file's bytes out: the message burns, the bytes go with it. */
export function dropPayload(
  store: PayloadStore,
  roomId: string,
  messageId: string,
): PayloadStore {
  if (!(messageId in store)) return store;
  const next = { ...store };
  delete next[messageId];
  void roomId;
  return next;
}

/** Drop every file of a room: the room is gone, or locked, or burned. */
export function clearRoomPayloads(store: PayloadStore, roomId: string): PayloadStore {
  const ids = Object.keys(store).filter((id) => store[id].roomId === roomId);
  if (!ids.length) return store;
  const next = { ...store };
  for (const id of ids) delete next[id];
  return next;
}

/* ------------------------------------------------------------------
   The shared edits. They take the store's set, so every slice can
   reach them without importing the store.
   ------------------------------------------------------------------ */

/** A line the room says about itself: joined, left, re-sealed. */
export function addSystemLine(set: StoreSet, roomId: string, text: string): void {
  const line: MessageView = {
    id: crypto.randomUUID(),
    kind: "system",
    status: "sent",
    ts: Date.now(),
    text,
  };
  appendToRoom(set, roomId, line);
}

/** Change one letter in place. */
export function patchView(
  set: StoreSet,
  roomId: string,
  messageId: string,
  patch: Partial<MessageView>,
): void {
  set((s) => ({
    messages: {
      ...s.messages,
      [roomId]: patchMessage(s.messages[roomId] ?? [], messageId, patch),
    },
  }));
}

/** A letter burning: phase one marks it, phase two takes it out. The
 *  bytes go with it, so a burned file leaves nothing behind. */
export function onMessageBurn(set: StoreSet, roomId: string, messageId: string): void {
  set((s) => ({
    messages: {
      ...s.messages,
      [roomId]: patchMessage(s.messages[roomId] ?? [], messageId, { status: "burning" }),
    },
  }));
  setTimeout(() => {
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: removeMessage(s.messages[roomId] ?? [], messageId),
      },
      filePayloads: dropPayload(s.filePayloads, roomId, messageId),
    }));
  }, 620);
}

/* ------------------------------------------------------------------
   The message actions: sending, spending, marking, burning.
   ------------------------------------------------------------------ */

export const messagesSlice: AppSlice = (set, get) => ({
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
      // The bytes do not ride in the message: the message names the
      // file, and the bytes live in the payload store.
      file: file ? { name: file.name, mime: file.mime, size: file.size } : undefined,
      ttlSec,
      expiresAt: ttlSec ? ts + ttlSec * 1000 : undefined,
      viewOnce: file && viewOnce ? true : undefined,
      replyTo: reply,
    };

    appendToRoom(set, session.roomId, view, file?.dataB64);
    patchRoomCard(session.roomId, { lastActivity: ts });
    set({ roomCards: loadRoomCards() });

    if (ttlSec) {
      scheduleBurn(session.roomId, id, ts + ttlSec * 1000, (r, m) => onMessageBurn(set, r, m));
    }

    const relay = getRelay();
    for (const f of frames) {
      relay.emit("message:send", { roomId: session.roomId, envelope: f });
    }
  },

  /* --------------------------------------------- view-once --- */

  spendViewOnce: (roomId, messageId) => {
    patchView(set, roomId, messageId, { spent: true });
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
    set((s) => ({
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

    cancelBurnTimer(messageId);
    onMessageBurn(set, target, messageId);
  },
});
