// Task 19.3: KDF UPGRADE: argon2id (P1)
//
// Property: new rooms derive their entry key with argon2id (m=64MB,
// t=3, p=1) via hash-wasm, with a random 16-byte salt in a VERSIONED
// key bundle. Rooms created before the change (PBKDF2-SHA256, 750k,
// deterministic salt) still unlock with the same password.
//
// The bundle comes with a join verifier: an HMAC over the same
// derivation output, bound to the room. The server keeps it and never
// publishes it, and the client uses it to prove it knows the password
// without sending the password or the key. See join-proof.ts.

import { describe, it, expect } from "vitest";
import {
  createKeyBundleV2,
  unlockWithBundle,
  ARGON2_PARAMS,
} from "@/lib/kdf";
import { deriveRoomKey, makeVerifier } from "@/lib/crypto";

describe("argon2id key bundles (v2)", () => {
  it("creates a versioned argon2id bundle with the specified cost and a random salt", async () => {
    const { key, bundle, joinVerifier } = await createKeyBundleV2(
      "correct horse battery",
      "ROOM",
    );
    expect(key).toBeTruthy();
    expect(bundle.v).toBe(2);
    expect(bundle.alg).toBe("argon2id");
    expect(bundle.m).toBe(ARGON2_PARAMS.m);
    expect(bundle.t).toBe(ARGON2_PARAMS.t);
    expect(bundle.p).toBe(ARGON2_PARAMS.p);
    expect(bundle.m).toBe(65536); // 64 MB of memory hardness
    expect(bundle.salt.length).toBeGreaterThanOrEqual(16);
    expect(joinVerifier.length).toBeGreaterThan(16);
  });

  it("the join verifier never rides inside the public bundle", async () => {
    const { bundle, joinVerifier } = await createKeyBundleV2("a password", "ROOM");
    // The bundle is world-readable (it is the offline password
    // oracle). The verifier must not be in it.
    expect(JSON.stringify(bundle)).not.toContain(joinVerifier);
    expect(Object.keys(bundle)).not.toContain("joinProof");
  });

  it("two bundles for the same password use different salts and derive different keys", async () => {
    const a = await createKeyBundleV2("same password", "ROOM");
    const b = await createKeyBundleV2("same password", "ROOM");
    expect(a.bundle.salt).not.toBe(b.bundle.salt);
    const okA = await unlockWithBundle("same password", JSON.stringify(a.bundle), "ROOM", 1);
    const wrongKey = await unlockWithBundle("same password", JSON.stringify(b.bundle), "ROOM", 1);
    expect(okA).not.toBeNull();
    expect(wrongKey).not.toBeNull();
    // Different salts → different keys → a's bundle verifier must NOT
    // validate under b's key:
    const { checkVerifier } = await import("@/lib/crypto");
    if (okA && wrongKey) {
      expect(await checkVerifier(wrongKey.key, JSON.stringify(a.bundle))).toBe(false);
      expect(await checkVerifier(okA.key, JSON.stringify(a.bundle))).toBe(true);
    }
  });

  it("unlocks with the right password, rejects the wrong one", async () => {
    const { bundle } = await createKeyBundleV2("hunter2 is a bad idea", "ROOMX");
    const good = await unlockWithBundle(
      "hunter2 is a bad idea",
      JSON.stringify(bundle),
      "ROOMX",
      1,
    );
    expect(good).not.toBeNull();
    const bad = await unlockWithBundle("hunter2", JSON.stringify(bundle), "ROOMX", 1);
    expect(bad).toBeNull();
  });

  it("the join verifier comes back with the key, and the wrong password gets none", async () => {
    const { bundle } = await createKeyBundleV2("the right one", "ROOMV");
    const good = await unlockWithBundle("the right one", JSON.stringify(bundle), "ROOMV", 1);
    const bad = await unlockWithBundle("the wrong one", JSON.stringify(bundle), "ROOMV", 1);
    expect(good?.joinVerifier.length ?? 0).toBeGreaterThan(16);
    expect(bad).toBeNull();
  });
});

describe("legacy rooms (v1 PBKDF2) still unlock", () => {
  it("a pre-upgrade verifier blob unlocks through the same function", async () => {
    // Build a blob exactly the way the old code did.
    const legacyKey = await deriveRoomKey("OLDROOM", 3, "old-room-password");
    const legacyBlob = await makeVerifier(legacyKey);

    const unlocked = await unlockWithBundle("old-room-password", legacyBlob, "OLDROOM", 3);
    expect(unlocked).not.toBeNull();
    expect(unlocked?.joinVerifier.length ?? 0).toBeGreaterThan(16);

    const wrong = await unlockWithBundle("different", legacyBlob, "OLDROOM", 3);
    expect(wrong).toBeNull();
  });
});
