// The clocks. Every timer in the app lives here, in module memory
// like the keys: nothing here is persisted, and a page reload clears
// all of it.
//
// Five families:
//   burn       — a letter's own clock, when it leaves
//   typing     — the whisper's clock, and the send throttle
//   cover      — the heartbeat that hides silence
//   rotation   — the hourly re-seal check
//   grace      — the silent-departure clock
//
// The callbacks that reach back into the store are passed in, so this
// module stays a leaf: it never imports the store.

import { getCipher } from "@/lib/room-protocol";
import { getSession } from "@/lib/session";
import { getRelay } from "@/lib/relay";
import { SILENT_GRACE_MS } from "@/lib/silent-grace";
import type { StoreSet } from "@/store/types";

/* ------------ TTL burn scheduling (module memory) ------------ */
const burnTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** A letter's clock. When it runs, the letter leaves. */
export function scheduleBurn(
  roomId: string,
  messageId: string,
  expiresAt: number,
  onBurn: (roomId: string, messageId: string) => void,
): void {
  if (burnTimers.has(messageId)) return;
  const delay = Math.max(0, expiresAt - Date.now());
  const t = setTimeout(() => {
    burnTimers.delete(messageId);
    onBurn(roomId, messageId);
  }, delay);
  burnTimers.set(messageId, t);
}

/** Stop one letter's clock: the letter was burned by hand. */
export function cancelBurnTimer(messageId: string): void {
  const t = burnTimers.get(messageId);
  if (t) {
    clearTimeout(t);
    burnTimers.delete(messageId);
  }
}

/** Stop every clock in a room: the room is over, or you left it. */
export function cancelBurns(roomId: string, messages: { id: string }[]): void {
  for (const m of messages) {
    if (m.id) cancelBurnTimer(m.id);
  }
  void roomId;
}

/* ------------ typing whispers (transient by design) ------------ */
export const TYPING_TTL_MS = 3500;
export const TYPING_EMIT_THROTTLE_MS = 2500;
const typingLastEmit = new Map<string, number>();
const typingPruneTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The typing signal's own clock: after it, the whisper is gone. */
export function pruneTypingLater(set: StoreSet, roomId: string): void {
  const existing = typingPruneTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    typingPruneTimers.delete(roomId);
    set((s) => {
      const fresh = (s.typing[roomId] ?? []).filter(
        (x) => Date.now() - x.at < TYPING_TTL_MS,
      );
      return { typing: { ...s.typing, [roomId]: fresh } };
    });
  }, TYPING_TTL_MS + 100);
  typingPruneTimers.set(roomId, t);
}

/** Has this room said "someone is writing" too recently? */
export function typingThrottled(roomId: string): boolean {
  const now = Date.now();
  const last = typingLastEmit.get(roomId) ?? 0;
  if (now - last < TYPING_EMIT_THROTTLE_MS) return true;
  typingLastEmit.set(roomId, now);
  return false;
}

/** One member stopped writing. */
export function clearTyping(set: StoreSet, roomId: string, memberId: string): void {
  set((s) => {
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

/* ---------------- cover traffic (round 33) ---------------- */
// Sealed cover frames on a steady cadence, per room. The wire shape
// is byte-identical to a text message (20480+16 control bytes,
// AES-256-GCM), so the relay cannot tell silent from speaking. The
// interval is room-scoped and stopped the moment the room session ends.

export const COVER_INTERVAL_MS = 8_000; // the steady cadence; ±25% jitter
const coverTimers = new Map<string, ReturnType<typeof setInterval>>();

export function startCoverFor(roomId: string): void {
  stopCoverFor(roomId); // idempotent: never two timers for one room
  const tick = () => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher || !session.coverTraffic) return;
    const frames = cipher.sealCover();
    void frames.then((fs) => {
      const relay = getRelay();
      for (const f of fs) relay.emit("message:send", { roomId, envelope: f });
    });
  };
  // Jitter: a perfectly metronomic sender is itself a signal. 8s ± up
  // to 2s each tick, enough to blur the heartbeat without breaking it.
  const ms = COVER_INTERVAL_MS + Math.floor(Math.random() * 2000);
  coverTimers.set(roomId, setInterval(tick, ms));
}

export function stopCoverFor(roomId: string): void {
  const t = coverTimers.get(roomId);
  if (t !== undefined) {
    clearInterval(t);
    coverTimers.delete(roomId);
  }
}

/* ---------------- time-based key rotation (round 33) ---------------- */
// Rotations happen on leave and eviction already; this covers the room
// that simply sits. The coordinator (deterministic: smallest connected
// memberId) seals a new random key once the current one is an hour old,
// delivered pairwise exactly like a depart rotation. Everyone else just
// installs the offer when it arrives. If the coordinator vanishes mid-
// window, the silent-grace path elects the next lowest member first, so
// the schedule restarts instead of stalling.

export const ROTATION_TICK_MS = 60_000; // check key age once a minute
const rotationTimers = new Map<string, ReturnType<typeof setInterval>>();

export function startRotationFor(
  roomId: string,
  onSystemLine: (roomId: string, text: string) => void,
): void {
  stopRotationFor(roomId); // idempotent
  rotationTimers.set(
    roomId,
    setInterval(() => {
      const cipher = getCipher(roomId);
      const session = getSession(roomId);
      if (!cipher || !session) return;
      const now = Date.now();
      if (cipher.expectedCoordinator() !== session.memberId) return;
      if (!cipher.currentKeyStaleAt(now)) return;
      // rot=false: same ECDH-wrapped, signed, registry-gated delivery,
      // but not the leave ceremony, so receivers install silently. The
      // single user-visible line comes from us, once, on schedule.
      void cipher.rotateTo(undefined, false).then((offers) => {
        const relay = getRelay();
        for (const f of offers) relay.emit("message:send", { roomId, envelope: f });
        if (offers.length > 0) {
          onSystemLine(roomId, "The room re-sealed itself on schedule.");
        }
      });
    }, ROTATION_TICK_MS),
  );
}

export function stopRotationFor(roomId: string): void {
  const t = rotationTimers.get(roomId);
  if (t !== undefined) {
    clearInterval(t);
    rotationTimers.delete(roomId);
  }
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

export function startGraceTimer(
  roomId: string,
  memberId: string,
  onEvict: (roomId: string, memberId: string) => void,
): void {
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
      onEvict(roomId, memberId);
    }, SILENT_GRACE_MS),
  );
}

export function cancelGraceTimer(roomId: string, memberId: string): void {
  silentGrace.get(roomId)?.delete(memberId);
}

export function clearRoomGrace(roomId: string): void {
  const room = silentGrace.get(roomId);
  if (!room) return;
  for (const t of room.values()) clearTimeout(t);
  silentGrace.delete(roomId);
}

export function clearAllGrace(): void {
  for (const room of silentGrace.values()) for (const t of room.values()) clearTimeout(t);
  silentGrace.clear();
}
