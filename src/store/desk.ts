// The desk: the room cards on this device, and the touches on them.
// The cards live in localStorage (lib/local.ts); this module is the
// bridge between that store and the state.

import { loadRoomCards, patchRoomCard } from "@/lib/local";
import type { StoreGet, StoreSet } from "@/store/types";

/** Room-card touch. `letters` > 0 counts real letters for the
 *  unread badge (dot-only for joins and rejections); unread=false
 *  (the room is being read) always resets the count. */
export function touchCard(
  set: StoreSet,
  roomId: string,
  unread: boolean,
  letters = 0,
): void {
  const card = loadRoomCards().find((c) => c.roomId === roomId);
  const nextCount = unread
    ? Math.min(99, (card?.unreadCount ?? 0) + letters)
    : 0;
  patchRoomCard(roomId, {
    lastActivity: Date.now(),
    unread,
    ...(unread || letters > 0 || card?.unreadCount ? { unreadCount: nextCount } : {}),
  });
  set({ roomCards: loadRoomCards() });
}

/** The room's local name, for notices that name the room. */
export function roomNameOf(get: StoreGet, roomId: string): string {
  return (
    get().roomCards.find((c) => c.roomId === roomId)?.localName ?? "Room"
  );
}

/** The room is waiting for a key that has not arrived. */
export function setResealing(set: StoreSet, roomId: string, value: boolean): void {
  set((s) => {
    const next = { ...s.resealing };
    if (value) next[roomId] = true;
    else delete next[roomId];
    return { resealing: next };
  });
}
