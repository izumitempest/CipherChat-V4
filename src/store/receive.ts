// The receive pipeline: a frame arrives, the cipher decides, and the
// result becomes a letter.
//
// Every security decision lives in RoomCipher.open: shape, registry
// eviction, key version, signature, replay. This module only turns an
// OpenResult into UI, and it trusts the result completely.
//
// The legacy path, for rooms sealed before protocol v2, is here too:
// it decodes the old envelope, verifies the old canonical, and then
// does the same as everything else.

import { verifyCanonical, canonicalFor, decryptJson } from "@/lib/crypto";
import { notifyIncoming } from "@/lib/notifications";
import { getRelay } from "@/lib/relay";
import { getCipher, type OpenResult } from "@/lib/room-protocol";
import { getSession } from "@/lib/session";
import type { WireFrame } from "@/lib/protocol";
import {
  sanitizeReplySnapshot,
  type MemberPublic,
  type Payload,
  type ReactionMark,
  type WireEnvelope,
} from "@/lib/types";
import {
  addSystemLine,
  applyMarkToggle,
  appendToRoom,
  onMessageBurn,
  patchView,
} from "@/store/messages";
import { roomNameOf, setResealing, touchCard } from "@/store/desk";
import { cancelBurnTimer, clearTyping, pruneTypingLater, scheduleBurn } from "@/store/timers";
import type { StoreGet, StoreSet } from "@/store/types";

/* ------------------------------------------------------------------
   v2 receive path: every security decision lives in the cipher
   ------------------------------------------------------------------ */

export async function receiveFrame(
  set: StoreSet,
  get: StoreGet,
  roomId: string,
  frame: WireFrame,
): Promise<void> {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher) return;

  const result = await cipher.open(frame);
  await handleOpenResult(set, get, roomId, frame, result);

  // A frame we could not yet decrypt may mean we are a joiner (or a
  // reconnecter) waiting for key delivery; ask for it, quietly.
  if (result.type === "pending" && cipher.kv === 1) {
    const now = Date.now();
    const last = keyReqLastEmit.get(roomId) ?? 0;
    if (now - last > KEYREQ_THROTTLE_MS) {
      keyReqLastEmit.set(roomId, now);
      getRelay().emit("key:request", { roomId, from: session.memberId });
      setResealing(set, roomId, true);
    }
  }
}

async function handleOpenResult(
  set: StoreSet,
  get: StoreGet,
  roomId: string,
  frame: WireFrame,
  result: OpenResult,
): Promise<void> {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher) return;

  const registry = get().members[roomId] ?? [];
  const inRoom = get().activeRoomId === roomId;

  switch (result.type) {
    case "text": {
      const sender = registry.find((m) => m.memberId === result.body.senderId);
      if (!sender) return;
      const ttlSec = result.body.ttlSec;
      const view = {
        id: frame.id,
        kind: "text" as const,
        senderId: sender.memberId,
        senderAlias: sender.alias,
        senderColor: sender.colorIdx,
        self: sender.memberId === session.memberId,
        status: "sent" as const,
        ts: result.body.ts,
        text: result.body.text ?? "",
        replyTo: sanitizeReplySnapshot(result.body.reply),
        ttlSec,
        expiresAt: ttlSec ? result.body.ts + ttlSec * 1000 : undefined,
      };
      appendToRoom(set, roomId, view);
      clearTyping(set, roomId, sender.memberId);
      touchCard(set, roomId, !inRoom, 1);
      // A letter for a room the user isn't looking at rises as a
      // notice: banner while the app is open, system notification
      // while it's hidden. What it says follows the preview setting.
      if (!view.self && !inRoom) {
        notifyIncoming({
          roomId,
          roomName: roomNameOf(get, roomId),
          alias: sender.alias,
          colorIdx: sender.colorIdx,
          text: view.text,
        });
      }
      if (view.expiresAt) {
        scheduleBurn(roomId, view.id, view.expiresAt, (r, m) => onMessageBurn(set, r, m));
      }
      return;
    }

    case "typing": {
      if (result.senderId === session.memberId) return;
      const sender = registry.find((m) => m.memberId === result.senderId);
      set((s) => {
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
      pruneTypingLater(set, roomId);
      return;
    }

    case "spent": {
      patchView(set, roomId, result.messageId, { spent: true });
      return;
    }

    case "react": {
      // A margin mark on a message. If the target is gone (expired, or
      // sent before this member joined), the mark simply has nothing
      // to annotate: quietly ignored.
      clearTyping(set, roomId, result.senderId);
      set((s) => ({
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
      const target = (get().messages[roomId] ?? []).find(
        (m) => m.id === result.messageId,
      );
      // The cipher already verified the author's signature; make sure
      // the target is actually the author's own letter.
      if (!target || target.kind === "system" || target.senderId !== result.senderId) return;
      cancelBurnTimer(result.messageId);
      onMessageBurn(set, roomId, result.messageId);
      return;
    }

    case "file": {
      const sender = registry.find((m) => m.memberId === result.senderId);
      if (!sender) return;
      const view = {
        id: result.file.messageId,
        kind: "file" as const,
        senderId: sender.memberId,
        senderAlias: sender.alias,
        senderColor: sender.colorIdx,
        self: sender.memberId === session.memberId,
        status: "sent" as const,
        ts: result.ts,
        text: result.text,
        replyTo: sanitizeReplySnapshot(result.reply),
        // The bytes do not ride in the message: the message names the
        // file, and the bytes live in the payload store under the
        // room's budget. The list stays light.
        file: {
          name: result.file.name,
          mime: result.file.mime,
          size: result.file.size,
        },
        ttlSec: result.file.ttlSec,
        expiresAt: result.file.ttlSec ? result.ts + result.file.ttlSec * 1000 : undefined,
        viewOnce: result.file.viewOnce,
      };
      appendToRoom(set, roomId, view, result.file.dataB64);
      clearTyping(set, roomId, sender.memberId);
      touchCard(set, roomId, !inRoom, 1);
      if (!view.self && !inRoom) {
        notifyIncoming({
          roomId,
          roomName: roomNameOf(get, roomId),
          alias: sender.alias,
          colorIdx: sender.colorIdx,
          text: result.text,
          isFile: true,
        });
      }
      if (view.expiresAt) {
        scheduleBurn(roomId, view.id, view.expiresAt, (r, m) => onMessageBurn(set, r, m));
      }
      return;
    }

    case "file-meta":
    case "file-chunk":
      return; // assembly happens inside the cipher; render on completion

    case "cover":
      return; // accepted by protocol (signature+replay OK), discarded.

    case "offer-installed": {
      session.kv = cipher.kv;
      setResealing(set, roomId, false);
      if (result.rotation) {
        addSystemLine(set, roomId, "The room re-sealed for those who remain.");
      }
      // Frames that were parked waiting for this key.
      const drained = await cipher.drainPending();
      for (const { frame: parked, result: r } of drained) {
        await handleOpenResult(set, get, roomId, parked, r).catch(() => undefined);
      }
      return;
    }

    case "pending":
      return;

    case "reject": {
      if (result.reason === "signature") {
        const sender = registry.find((m) => m.memberId === frame.from);
        addSystemLine(
          set,
          roomId,
          `A message claiming to be from ${sender?.alias ?? "an unknown member"} was rejected - signature invalid.`,
        );
        touchCard(set, roomId, !inRoom);
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

export async function receiveLegacyEnvelope(
  set: StoreSet,
  get: StoreGet,
  roomId: string,
  envelope: WireEnvelope,
): Promise<void> {
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

  const registry = get().members[roomId] ?? [];
  const sender = registry.find((m) => m.memberId === envelope.senderId);

  if (!payload || !sender) {
    addSystemLine(
      set,
      roomId,
      `A message claiming to be from ${sender?.alias ?? "an unknown member"} was rejected - signature invalid.`,
    );
    touchCard(set, roomId, get().activeRoomId !== roomId);
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
      set,
      roomId,
      `A message claiming to be from ${sender.alias} was rejected - signature invalid.`,
    );
    touchCard(set, roomId, get().activeRoomId !== roomId);
    return;
  }

  const view = {
    id: envelope.id,
    kind: envelope.kind,
    senderId: sender.memberId,
    senderAlias: sender.alias,
    senderColor: sender.colorIdx,
    self: sender.memberId === session.memberId,
    status: "sent" as const,
    ts: payload.ts,
    text: payload.text,
    file: payload.file
      ? {
          name: payload.file.name,
          mime: payload.file.mime,
          size: payload.file.size,
        }
      : undefined,
    ttlSec: envelope.ttlSec,
    expiresAt: envelope.ttlSec ? payload.ts + envelope.ttlSec * 1000 : undefined,
    viewOnce: envelope.viewOnce,
  };
  appendToRoom(set, roomId, view, payload.file?.dataB64);
  clearTyping(set, roomId, sender.memberId);
  touchCard(set, roomId, get().activeRoomId !== roomId, 1);
  if (view.expiresAt) {
    scheduleBurn(roomId, view.id, view.expiresAt, (r, m) => onMessageBurn(set, r, m));
  }
}

/* ------------ join-key requests (self-healing delivery) ------------ */
const KEYREQ_THROTTLE_MS = 5000;
const keyReqLastEmit = new Map<string, number>();
