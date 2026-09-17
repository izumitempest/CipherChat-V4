// Task 19.4 — PER-ROOM SIGNING KEYS (P1)
//
// Property: the device holds one random seed; each room gets its own
// ECDSA P-256 keypair derived via HKDF(seed, roomId). Same device, two
// rooms → different pubkeys in the member registries, different
// aliases. Same room revisited (refresh + unlock) → same key, so
// verification marks and "returned" recognition keep working.

import { describe, it, expect } from "vitest";
import { deriveRoomSigningKey } from "@/lib/room-identity";
import { aliasFromFingerprint, inkFromFingerprint } from "@/lib/identity";
import { signCanonical, verifyCanonical } from "@/lib/crypto";

describe("per-room signing identity", () => {
  it("is stable for the same (seed, room) — survives refresh", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(seed, "ROOMA");
    const b = await deriveRoomSigningKey(seed, "ROOMA");
    expect(a.privJwk.d).toBe(b.privJwk.d);
    expect(a.pubJwk.x).toBe(b.pubJwk.x);
    expect(a.fingerprintHex).toBe(b.fingerprintHex);
  });

  it("differs across rooms — the server's registries cannot be correlated", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(seed, "ROOMA");
    const b = await deriveRoomSigningKey(seed, "ROOMB");
    expect(a.pubJwk.x).not.toBe(b.pubJwk.x);
    expect(a.pubJwk.y).not.toBe(b.pubJwk.y);
    expect(a.fingerprintHex).not.toBe(b.fingerprintHex);
  });

  it("aliases (and inks) differ across rooms for the same person", async () => {
    // Search deterministically for a seed where both alias and ink
    // differ, so the assertion is stable, not flaky.
    let seed = new Uint8Array(32).fill(1);
    for (let i = 0; i < 64; i++) {
      const a = await deriveRoomSigningKey(seed, "ROOMA");
      const b = await deriveRoomSigningKey(seed, "ROOMB");
      const aliasA = aliasFromFingerprint(a.fingerprintHex);
      const aliasB = aliasFromFingerprint(b.fingerprintHex);
      if (aliasA !== aliasB && inkFromFingerprint(a.fingerprintHex) !== inkFromFingerprint(b.fingerprintHex)) {
        expect(aliasA).not.toBe(aliasB);
        return;
      }
      seed = crypto.getRandomValues(new Uint8Array(32));
    }
    throw new Error("could not find differing aliases in 64 tries (improbable)");
  });

  it("derived keys are valid WebCrypto ECDSA P-256 keys that sign and verify", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(seed, "SIGNROOM");
    const b = await deriveRoomSigningKey(seed, "OTHERROOM");

    const sig = await signCanonical(a.privJwk, "payload");
    expect(await verifyCanonical(a.pubJwk, "payload", sig)).toBe(true);
    // cross-room key must NOT verify
    expect(await verifyCanonical(b.pubJwk, "payload", sig)).toBe(false);
  });

  it("the same seed never produces an invalid scalar (derivation always succeeds)", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    for (const room of ["R1", "R2", "R3", "R4", "R5"]) {
      const k = await deriveRoomSigningKey(seed, room);
      expect(k.pubJwk.x).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
