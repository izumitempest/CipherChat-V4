// The creator token.
//
// The token authorizes two things: burning a room and changing its
// lifetime. It is a bearer secret, so whoever holds it can do both.
//
// It used to sit in SQLite in the clear, and the comment in the room
// route claimed the server only held something hash-comparable. That
// was not true. The server now stores sha256(token) and compares in
// constant time, so a database dump does not hand out a working
// burn key.
//
// The client keeps the token in localStorage, because burning has to
// work after a refresh. The token still exists on the device that
// made the room. What it no longer does is sit in the database.
//
// Rooms created before the change stored the token plain. The first
// time the plain token is presented, it is replaced by its hash, so
// old rooms upgrade themselves as they are used.

import { equalInConstantTime } from "./crypto";
import { sha256Hex } from "./identity";

/** The stored form of a creator token. Domain separated, so the hash
 *  of a token cannot be mistaken for the hash of anything else. */
export async function hashCreatorToken(token: string): Promise<string> {
  return sha256Hex(`cc-creator-token-v1:${token}`);
}

/** Does the presented token match the stored one?
 *
 *  The stored value is the hash. The plain token is still accepted for
 *  rooms that predate the hash, and the caller should then re-store
 *  the hash (see upgradeCreatorToken). */
export async function creatorTokenMatches(
  stored: string | null | undefined,
  presented: string | null | undefined,
): Promise<boolean> {
  if (!stored || typeof presented !== "string" || presented.length === 0) return false;
  const hash = await hashCreatorToken(presented);
  if (equalInConstantTime(stored, hash)) return true;
  return equalInConstantTime(stored, presented);
}

/** The stored value is the plain token, not a hash. */
export function isPlainCreatorToken(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return stored.length !== 64 || !/^[0-9a-f]{64}$/.test(stored);
}
