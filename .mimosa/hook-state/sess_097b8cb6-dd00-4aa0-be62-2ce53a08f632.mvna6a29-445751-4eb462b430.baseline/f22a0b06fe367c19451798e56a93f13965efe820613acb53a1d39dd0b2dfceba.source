// Task 19.4: PER-ROOM SIGNING KEYS (P1)
//
// Property: the device holds one random seed; each room gets its own
// ECDSA P-256 keypair derived via HKDF(seed, roomId). Same device, two
// rooms → different pubkeys in the member registries, different
// aliases. Same room revisited (refresh + unlock) → same key, so
// verification marks and "returned" recognition keep working.

import { describe, it, expect } from "vitest";
import { deriveRoomSigningKey, deriveRoomSigningKeyFromSeed } from "@/lib/room-identity";
import { aliasFromFingerprint, inkFromFingerprint } from "@/lib/identity";
import { signCanonical, verifyCanonical } from "@/lib/crypto";

// Golden vector: fixed seed, fixed room. If any refactor of the
// derivation (byte path or vault path) drifts, this fails loudly.
const GOLDEN_SEED_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const GOLDEN_ROOM = "GOLDEN-ROOM";
const GOLDEN_FINGERPRINT =
  "9caf91b05763b40797dcab77d0a1b49c72860c2beed7bed8b743ee3838b8eabc";

describe("per-room signing identity", () => {
  it("is stable for the same (seed, room) - survives refresh", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(seed, "ROOMA");
    const b = await deriveRoomSigningKey(seed, "ROOMA");
    expect(a.privJwk.d).toBe(b.privJwk.d);
    expect(a.pubJwk.x).toBe(b.pubJwk.x);
    expect(a.fingerprintHex).toBe(b.fingerprintHex);
  });

  it("differs across rooms - the server's registries cannot be correlated", async () => {
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

  /* ---------------- vault-path equivalence (seed stored as a
   * non-extractable CryptoKey in IndexedDB) ---------------- */

  it("the vault path derives byte-identical identities to the byte path", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const asKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
    for (const room of ["VAULT-A", "VAULT-B", GOLDEN_ROOM]) {
      const legacy = await deriveRoomSigningKey(seed, room);
      const vault = await deriveRoomSigningKeyFromSeed(asKey, room);
      expect(vault.pubJwk.x).toBe(legacy.pubJwk.x);
      expect(vault.pubJwk.y).toBe(legacy.pubJwk.y);
      expect(vault.fingerprintHex).toBe(legacy.fingerprintHex);
    }
  });

  it("the vault key's signing output verifies against its public half", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const asKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
    const vault = await deriveRoomSigningKeyFromSeed(asKey, "SIGN-VIA-VAULT");
    const sig = await signCanonical(vault.privKey, "payload");
    expect(await verifyCanonical(vault.pubJwk, "payload", sig)).toBe(true);
    const other = await deriveRoomSigningKeyFromSeed(asKey, "OTHER-VAULT-ROOM");
    expect(await verifyCanonical(other.pubJwk, "payload", sig)).toBe(false);
  });

  it("golden vector: fixed seed and room always produce the same fingerprint", async () => {
    const seedBytes = new Uint8Array(
      (() => {
        const s = atob(GOLDEN_SEED_B64);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
      })(),
    );
    // Byte path:
    const legacy = await deriveRoomSigningKey(seedBytes, GOLDEN_ROOM);
    expect(legacy.fingerprintHex).toBe(GOLDEN_FINGERPRINT);
    // Vault path (CryptoKey, as stored non-extractably in IndexedDB):
    const asKey = await crypto.subtle.importKey("raw", seedBytes, "HKDF", false, ["deriveBits"]);
    const vault = await deriveRoomSigningKeyFromSeed(asKey, GOLDEN_ROOM);
    expect(vault.fingerprintHex).toBe(GOLDEN_FINGERPRINT);
  });
});
