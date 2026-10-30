// The registry janitor. Rooms are meant to be ephemeral, so expired
// and burned rooms must actually LEAVE the database rather than
// accumulate forever. Previously the expired-room sweep ran only on
// the room-CREATE path (a quiet server never swept), and burned rooms
// were flagged but never deleted at all — for an "ephemeral" product
// the SQLite file only ever grew.
//
// Both sweeps are cheap, idempotent deleteMany calls (members cascade)
// and are wired into the two natural moments: room creation (as
// before) and room-info reads (rate-limited, so bounded frequency).

import { db } from "./db";

/** Burned rooms linger this long, so an operator can look at the room
 *  row after the fact, then go. 7 days matches the product's longest
 *  room lifetime preset. */
export const BURNED_ROOM_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** A room with no expiry ("until burned") is swept after this long,
 *  and only when nobody is in it. The promise is that a room lives
 *  until it is burned, so the backstop is a year, not a day, and a
 *  room with a member still in it is left alone. The rule is written
 *  down in the room lifetime copy and in DESIGN.md. */
export const UNEXPIRED_ROOM_RETENTION_MS = 365 * 24 * 60 * 60_000;

/** Delete rooms whose time ran out (members cascade). */
export async function sweepExpiredRooms(): Promise<number> {
  const res = await db.room.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}

/** Delete burned rooms past the retention window (members cascade;
 *  there are none by burn-time anyway). */
export async function sweepBurnedRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - BURNED_ROOM_RETENTION_MS);
  const res = await db.room.deleteMany({
    where: { burned: true, burnedAt: { lt: cutoff } },
  });
  return res.count;
}

/** Delete rooms with no expiry that nobody has been in for a year
 *  (members cascade). These are the "until burned" rooms, and they
 *  used to sit in the database forever: the expired sweep only
 *  matched rooms whose clock had run out, and a null expiresAt is
 *  not less than anything in sqlite.
 *
 *  A room with a member still in it is never touched. The condition
 *  is every member row inactive AND last seen before the cutoff, so
 *  a room somebody is sitting in stays. */
export async function sweepDormantRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - UNEXPIRED_ROOM_RETENTION_MS);
  const res = await db.room.deleteMany({
    where: {
      expiresAt: null,
      burned: false,
      createdAt: { lt: cutoff },
      members: { every: { active: false, lastSeenAt: { lt: cutoff } } },
    },
  });
  return res.count;
}

/** The full janitor ride-along. Fire-and-forget safe: a failure here
 *  must never fail the caller's request. */
export async function sweepRooms(): Promise<void> {
  try {
    await sweepExpiredRooms();
    await sweepBurnedRooms();
    await sweepDormantRooms();
  } catch {
    /* tidiness, not correctness; the next ride-along retries */
  }
}
