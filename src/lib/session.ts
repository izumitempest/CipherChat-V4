// Session state — memory only. This is the product truth that makes
// refresh lock every room: the room key lives in the RoomCipher (also
// memory only, see room-protocol.ts), the password lives here, and
// neither is ever written to disk. Close the tab, hit refresh — the
// desk stays, the keys are gone, and each room must be unlocked again.

import type { TtlChoice } from "./types";

export interface RoomSession {
  roomId: string;
  memberId: string;
  alias: string;
  colorIdx: number;
  /** current room key version (1 = the password-derived entry key;
   *  higher versions = random keys delivered over ECDH) */
  kv: number;
  /** in-memory only — the shared secret that gates join delivery */
  password: string;
  creatorToken?: string;
  defaultTtl: TtlChoice;
  /** true only for rooms whose key bundle predates protocol v2 —
   *  gates the legacy (unpadded, unguarded) envelope receive path */
  legacy: boolean;
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
