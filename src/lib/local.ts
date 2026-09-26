// Local persistence on this device only. Room *labels*, verification
// marks, and per-room settings live on this device. Keys never do.
// Burned rooms are filtered out on the next page load: the ash card
// is shown for the remainder of the session, then vanishes.

import type { RoomCard, TtlChoice } from "./types";
import type { WatermarkStore } from "./room-protocol";

const ROOMS_KEY = "cc.rooms";

export function loadRoomCards(): RoomCard[] {
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RoomCard[];
  } catch {
    return [];
  }
}

/** Page-load sweep: burned rooms showed their ash and closed rooms
 *  showed their quiet clock for the session in which they ended; on
 *  the next load they are gone for good. */
export function sweepBurnedRooms(): RoomCard[] {
  const cards = loadRoomCards().filter((c) => !c.burned && !c.closed);
  saveRoomCards(cards);
  return cards;
}

export function saveRoomCards(cards: RoomCard[]): void {
  localStorage.setItem(ROOMS_KEY, JSON.stringify(cards));
}

export function upsertRoomCard(card: RoomCard): RoomCard[] {
  const cards = loadRoomCards();
  const idx = cards.findIndex((c) => c.roomId === card.roomId);
  if (idx >= 0) cards[idx] = { ...cards[idx], ...card, burned: card.burned };
  else cards.unshift(card);
  saveRoomCards(cards);
  return cards;
}

export function patchRoomCard(
  roomId: string,
  patch: Partial<RoomCard>,
): RoomCard[] {
  const cards = loadRoomCards();
  const idx = cards.findIndex((c) => c.roomId === roomId);
  if (idx >= 0) {
    cards[idx] = { ...cards[idx], ...patch };
    saveRoomCards(cards);
  }
  return cards;
}

export function removeRoomCard(roomId: string): RoomCard[] {
  const cards = loadRoomCards().filter((c) => c.roomId !== roomId);
  saveRoomCards(cards);
  return cards;
}

export function clearUnread(): RoomCard[] {
  const cards = loadRoomCards();
  for (const c of cards) c.unread = false;
  saveRoomCards(cards);
  return cards;
}

/* ---------------- creator token (device-local, like the signing key) ---- */

export function saveCreatorToken(roomId: string, token: string): void {
  localStorage.setItem(`cc.creator.${roomId}`, token);
}

export function loadCreatorToken(roomId: string): string | undefined {
  return localStorage.getItem(`cc.creator.${roomId}`) ?? undefined;
}

/* ---------------- verification marks ---------------- */

export function loadVerified(roomId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`cc.verified.${roomId}`) ?? "[]");
  } catch {
    return [];
  }
}

export function saveVerified(roomId: string, memberIds: string[]): void {
  localStorage.setItem(`cc.verified.${roomId}`, JSON.stringify(memberIds));
}

/* ---------------- one-time education ---------------- */

const TTL_HINT_KEY = "cc.ttlHintShown";

/** Has the timer already explained itself on this device? */
export function ttlHintSeen(): boolean {
  try {
    return !!localStorage.getItem(TTL_HINT_KEY);
  } catch {
    return false;
  }
}

export function markTtlHintSeen(): void {
  try {
    localStorage.setItem(TTL_HINT_KEY, "1");
  } catch {
    /* private mode; it will show again next session */
  }
}

/* ---------------- replay watermarks (per room, per device) ---------------- */

/** Persists per-(sender, session) counter watermarks so a page refresh
 *  does not reset the replay defense. Bounded by the cipher (512
 *  entries); survives as long as the room card does. */
export function roomWatermarkStore(roomId: string): WatermarkStore {
  const key = `cc.wm.${roomId}`;
  return {
    load() {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
      } catch {
        return {};
      }
    },
    save(data) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        /* storage unavailable; defense degrades to per-page-load */
      }
    },
  };
}

/* ---------------- per-room local settings ---------------- */

export interface RoomSettings {
  defaultTtl: TtlChoice;
}

export function loadRoomSettings(roomId: string): RoomSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`cc.settings.${roomId}`) ?? "{}",
    );
    return { defaultTtl: (parsed.defaultTtl ?? 0) as TtlChoice };
  } catch {
    return { defaultTtl: 0 };
  }
}

export function saveRoomSettings(roomId: string, settings: RoomSettings): void {
  localStorage.setItem(`cc.settings.${roomId}`, JSON.stringify(settings));
}
