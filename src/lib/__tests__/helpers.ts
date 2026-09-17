// Shared test fixtures for the Task 19 security suite.
// Everything here runs in Node against the pure crypto modules —
// no DOM, no localStorage, no sockets.

import {
  generateSessionEcdh,
  RoomCipher,
  type RegistryEntry,
  type CipherInit,
} from "@/lib/room-protocol";

export async function randomAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export interface TestMember {
  id: string;
  cipher: RoomCipher;
}

/** A room of N members with cross-registered registries, one shared
 *  entry key (as if everyone derived it from the same password). */
export async function makeRoom(
  roomId: string,
  memberIds: string[],
  entryKey: CryptoKey,
  extra?: Partial<CipherInit>,
): Promise<TestMember[]> {
  const members: TestMember[] = [];
  const identities = await Promise.all(
    memberIds.map(async (id) => {
      const sig = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      );
      const privJwk = await crypto.subtle.exportKey("jwk", sig.privateKey);
      const pubJwk = await crypto.subtle.exportKey("jwk", sig.publicKey);
      const ecdh = await generateSessionEcdh();
      return { id, privJwk, pubJwk, ecdh };
    }),
  );

  const registry = new Map<string, RegistryEntry>();
  for (const m of identities) {
    registry.set(m.id, {
      pubkey: m.pubJwk,
      ecdhPubB64: m.ecdh.pubRawB64,
      connected: true,
    });
  }

  for (const m of identities) {
    const cipher = new RoomCipher({
      roomId,
      selfId: m.id,
      sig: { privJwk: m.privJwk, pubJwk: m.pubJwk },
      ecdh: m.ecdh,
      entryKey,
      ...extra,
    });
    // every member sees the full registry (incl. self)
    for (const [id, entry] of registry) cipher.registry.set(id, { ...entry });
    members.push({ id: m.id, cipher });
  }
  return members;
}

/** Deliver frames the way the relay would: to everyone (broadcast). */
export async function broadcast(
  frames: import("@/lib/protocol").WireFrame[],
  members: TestMember[],
  except?: string,
): Promise<import("@/lib/room-protocol").OpenResult[]> {
  const results: import("@/lib/room-protocol").OpenResult[] = [];
  for (const f of frames) {
    for (const m of members) {
      if (m.id === except) continue;
      results.push(await m.cipher.open(f));
    }
  }
  return results;
}
