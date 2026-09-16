// Session state — memory only. This is the product truth that makes
// refresh lock every room: derived keys and passwords live here and
// nowhere else. Close the tab, hit refresh — the desk stays, the keys
// are gone, and each room must be unlocked again.

import type { TtlChoice } from "./types";

export interface RoomSession {
  roomId: string;
  memberId: string;
  alias: string;
  colorIdx: number;
  epoch: number;
  password: string;
  creatorToken?: string;
  defaultTtl: TtlChoice;
  keys: Map<number, CryptoKey>;
  /** epoch keys currently deriving — dedupe concurrent derivations */
  pending: Map<number, Promise<CryptoKey>>;
}

const sessions = new Map<string, RoomSession>();

export function getSession(roomId: string): RoomSession | undefined {
  return sessions.get(roomId);
}

export function setSession(session: RoomSession): void {
  sessions.set(session.roomId, session);
}

export function dropSession(roomId: string): void {
  sessions.delete(roomId);
}

export function sessionRoomIds(): string[] {
  return Array.from(sessions.keys());
}

/** Get (or derive) the key for a room epoch. Deriving takes ~a second
 *  on purpose; concurrent requests share one derivation promise. */
export async function getEpochKey(session: RoomSession, epoch: number): Promise<CryptoKey> {
  const cached = session.keys.get(epoch);
  if (cached) return cached;
  const pending = session.pending.get(epoch);
  if (pending) return pending;

  const { deriveRoomKey } = await import("./crypto");
  const promise = deriveRoomKey(session.roomId, epoch, session.password)
    .then((key) => {
      session.keys.set(epoch, key);
      session.pending.delete(epoch);
      return key;
    })
    .catch((err) => {
      session.pending.delete(epoch);
      throw err;
    });
  session.pending.set(epoch, promise);
  return promise;
}
