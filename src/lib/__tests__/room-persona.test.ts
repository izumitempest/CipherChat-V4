// Task 48 — ROOM PERSONAS: multi-member in one browser.
//
// Property: every window of a browser shares the seed vault, so a
// second window in the same room must derive a DIFFERENT identity
// (its own member), while the first window keeps the historical
// vault identity byte-for-byte (fingerprints, verification marks and
// "returned" recognition survive).

import { describe, it, expect } from "vitest";
import {
  decidePersonaRole,
  personaInfoPrefixFromNonce,
} from "@/lib/room-persona";
import {
  deriveRoomSigningKey,
  deriveRoomSigningKeyFromSeed,
} from "@/lib/room-identity";

describe("persona role decision (pure core)", () => {
  it("no nonce + lock available → primary (the single-window behavior)", () => {
    expect(decidePersonaRole(null, true)).toBe("primary");
  });

  it("no nonce + lock taken → tab (a second window is here)", () => {
    expect(decidePersonaRole(null, false)).toBe("tab");
  });

  it("a tab that was ever a persona stays one, even if the lock frees (stickiness)", () => {
    // The primary window may be mid-reload; identities must not flip.
    expect(decidePersonaRole("abc123", true)).toBe("tab");
    expect(decidePersonaRole("abc123", false)).toBe("tab");
  });
});

describe("persona derivation", () => {
  it("a persona prefix yields a DIFFERENT identity than the primary prefix", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const primary = await deriveRoomSigningKey(seed, "ROOM-X");
    const persona = await deriveRoomSigningKey(
      seed,
      "ROOM-X",
      personaInfoPrefixFromNonce("deadbeef"),
    );
    expect(persona.fingerprintHex).not.toBe(primary.fingerprintHex);
    expect(persona.pubJwk.x).not.toBe(primary.pubJwk.x);
  });

  it("the same persona prefix is stable (refresh of that tab keeps its identity)", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(
      seed,
      "ROOM-Y",
      personaInfoPrefixFromNonce("cafe01"),
    );
    const b = await deriveRoomSigningKey(
      seed,
      "ROOM-Y",
      personaInfoPrefixFromNonce("cafe01"),
    );
    expect(a.fingerprintHex).toBe(b.fingerprintHex);
  });

  it("different persona nonces never collide (two second-windows)", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveRoomSigningKey(
      seed,
      "ROOM-Z",
      personaInfoPrefixFromNonce("nonce-a"),
    );
    const b = await deriveRoomSigningKey(
      seed,
      "ROOM-Z",
      personaInfoPrefixFromNonce("nonce-b"),
    );
    expect(a.fingerprintHex).not.toBe(b.fingerprintHex);
  });

  it("a persona identity is room-scoped like the primary identity", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const prefix = personaInfoPrefixFromNonce("scope1");
    const a = await deriveRoomSigningKey(seed, "ROOM-1", prefix);
    const b = await deriveRoomSigningKey(seed, "ROOM-2", prefix);
    expect(a.fingerprintHex).not.toBe(b.fingerprintHex);
  });

  it("the vault path derives the same persona split as the byte path", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const asKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
    const prefix = personaInfoPrefixFromNonce("vaultpath");
    const legacy = await deriveRoomSigningKey(seed, "ROOM-V", prefix);
    const vault = await deriveRoomSigningKeyFromSeed(asKey, "ROOM-V", prefix);
    expect(vault.fingerprintHex).toBe(legacy.fingerprintHex);
    expect(vault.pubJwk.x).toBe(legacy.pubJwk.x);
  });

  it("the persona prefix can never equal the primary prefix (namespace separation)", () => {
    // The primary derivation's info is exactly "cc-sig-v1"; every
    // persona info starts with "cc-sig-tab-v1:" — disjoint namespaces,
    // so a persona can never accidentally derive the primary identity.
    expect(personaInfoPrefixFromNonce("anything")).not.toBe("cc-sig-v1");
    expect(personaInfoPrefixFromNonce("anything")).toMatch(/^cc-sig-tab-v1:/);
  });
});
