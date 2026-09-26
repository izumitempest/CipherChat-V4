// Legacy support: rooms created before protocol v2 derive their keys
// with PBKDF2-SHA256 (750k iterations, deterministic salt). This module
// exists only so pre-upgrade rooms and old clients keep working; new
// rooms use argon2id bundles (see kdf.ts) and never touch this path.

import { deriveRoomKey } from "./crypto";
import type { RoomSession } from "./session";

const legacyKeys = new Map<string, CryptoKey>();

function key(roomId: string, epoch: number): string {
  return `${roomId}:${epoch}`;
}

/** Derive (or fetch from cache) a legacy epoch key for an old room. */
export async function getEpochKeyLegacy(
  roomId: string,
  epoch: number,
  password: string,
): Promise<CryptoKey> {
  const cached = legacyKeys.get(key(roomId, epoch));
  if (cached) return cached;
  const derived = await deriveRoomKey(roomId, epoch, password);
  legacyKeys.set(key(roomId, epoch), derived);
  return derived;
}

/** Forget cached legacy keys when a session ends. */
export function dropLegacyKeys(roomId: string): void {
  for (const k of [...legacyKeys.keys()]) {
    if (k.startsWith(`${roomId}:`)) legacyKeys.delete(k);
  }
}

export type { RoomSession };
