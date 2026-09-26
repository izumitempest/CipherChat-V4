// Session state, memory only. This is the product truth that makes
// refresh lock every room: the room key lives in the RoomCipher (also
// memory only, see room-protocol.ts), the password lives here, and
// neither is ever written to disk. Close the tab or hit refresh: the
// room cards stay, the keys are gone, and each room must be unlocked
// again.

import type { TtlChoice } from "./types";

export interface RoomSession {
  roomId: string;
  memberId: string;
  alias: string;
  colorIdx: number;
  /** current room key version (1 = the password-derived entry key;
   *  higher versions = random keys delivered over ECDH) */
  kv: number;
  /** in-memory only; retained for the room's open lifetime because
   *  the invite sheet re-displays and re-copies it (masked, with a
   *  reveal toggle) so a member can bring someone in at any time;
   *  legacy v1 rooms additionally re-derive epoch keys from it. Never
   *  written to disk; refresh locks every room and empties this. */
  password: string;
  creatorToken?: string;
  /** when this room's time runs out (ms epoch); undefined = until
   *  burned. Learned from the server at create/join; adjusted by
   *  the creator through adjustRoomTtl. */
  expiresAt?: number;
  defaultTtl: TtlChoice;
  /** true only for rooms whose key bundle predates protocol v2;
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
