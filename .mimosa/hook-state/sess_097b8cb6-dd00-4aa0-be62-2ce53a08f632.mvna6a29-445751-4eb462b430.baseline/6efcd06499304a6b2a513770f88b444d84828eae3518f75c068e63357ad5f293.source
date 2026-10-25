// Room lifetime: the creator decides how long the room exists, at
// creation and (with the creator token) later. Pure constants and
// helpers shared by the REST routes and the client UI; enforcement
// itself lives in the routes (expired rooms are refused and swept).

import { fmtTtlShort } from "./format";

/** Shortest room lifetime (5 minutes). */
export const ROOM_TTL_MIN_SEC = 300;
/** Longest (30 days): rooms are meant to expire, not to be archives. */
export const ROOM_TTL_MAX_SEC = 2_592_000;

/** What a creator is offered outright. 0 = no expiry ("until burned"). */
export const ROOM_TTL_PRESETS: { value: number; label: string; short: string }[] = [
  { value: 86400, label: "24 hours", short: "24h" },
  { value: 3600, label: "1 hour", short: "1h" },
  { value: 604800, label: "7 days", short: "7d" },
  { value: 2592000, label: "30 days", short: "30d" },
];

/** The suggested default: a day. */
export const ROOM_TTL_DEFAULT_SEC = 86400;

/** True when v is a lifetime the presets don't cover (and isn't 0). */
export function isCustomRoomTtl(v: number): boolean {
  return v !== 0 && !ROOM_TTL_PRESETS.some((p) => p.value === v);
}

/** Clamp a custom room lifetime into the sanctioned range. */
export function clampRoomTtl(v: number): number {
  if (!Number.isFinite(v)) return ROOM_TTL_DEFAULT_SEC;
  if (v === 0) return 0;
  return Math.min(ROOM_TTL_MAX_SEC, Math.max(ROOM_TTL_MIN_SEC, Math.round(v)));
}

/** Compact label for a room lifetime, days included: 3d · 7d · 5h. */
export function fmtRoomTtlShort(sec: number): string {
  if (sec <= 0) return "Until burned";
  if (sec >= 86400 && sec % 86400 === 0) return `${sec / 86400}d`;
  return fmtTtlShort(sec);
}

/** Human label for a room lifetime: "24 hours", "3 days", "1 hour 30 minutes". */
export function fmtRoomTtlLong(sec: number): string {
  if (sec <= 0) return "no expiry";
  const d = Math.floor(sec / 86400);
  const rest = sec % 86400;
  const restLabel = rest ? ` ${fmtTtlShort(rest)}` : "";
  if (d) return `${d} ${d === 1 ? "day" : "days"}${restLabel}`;
  const h = Math.floor(rest / 3600);
  const m = Math.floor((rest % 3600) / 60);
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** Parse a ttlSec from an untrusted JSON body. Returns:
 *  - { ok: true, ttlSec } for a valid value (0 = no expiry)
 *  - { ok: false } for anything else (caller returns 400). */
export function parseRoomTtlSec(input: unknown): { ok: true; ttlSec: number } | { ok: false } {
  if (typeof input !== "number" || !Number.isFinite(input) || !Number.isInteger(input)) {
    return { ok: false };
  }
  if (input !== 0 && (input < ROOM_TTL_MIN_SEC || input > ROOM_TTL_MAX_SEC)) {
    return { ok: false };
  }
  return { ok: true, ttlSec: input };
}

/** Has this room's time run out? (null expiresAt = until burned). */
export function roomExpired(expiresAt: Date | null | undefined): boolean {
  return !!expiresAt && expiresAt.getTime() <= Date.now();
}
