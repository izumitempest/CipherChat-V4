// Task 22.1: LEAVE PROOF-OF-POSSESSION
//
// Property: writing a member out of the registry (and rotating the
// room key out from under everyone) requires a valid ECDSA signature
// from that member's OWN room signing key over the canonical departure
// string; memberId alone proves nothing. A stranger who learns the
// roomId and a memberId can no longer force a rotation by "leaving"
// as someone else.

import { describe, it, expect } from "vitest";
import {
  LEAVE_PROOF_TOLERANCE_MS,
  leaveProofInput,
  signLeaveProof,
  verifyLeaveProof,
} from "@/lib/leave-proof";

async function makeKey(): Promise<{ privJwk: JsonWebKey; pubJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    pubJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

describe("leave proof-of-possession", () => {
  it("signs and verifies the exact canonical string", async () => {
    expect(leaveProofInput("ROOM", "MEM", 123)).toBe("cc-leave-v1:ROOM:MEM:123");
    const k = await makeKey();
    const proof = await signLeaveProof(k.privJwk, "ROOM", "MEM", 123);
    expect(proof.ts).toBe(123);
    // standard base64, not url-safe
    expect(proof.sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "MEM", 123, 123)).toBe(true);
  });

  it("a signature by a DIFFERENT key does not verify", async () => {
    const a = await makeKey();
    const b = await makeKey();
    const proof = await signLeaveProof(b.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyLeaveProof(a.pubJwk, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });

  it("a tampered canonical field (verifying for another memberId) does not verify", async () => {
    const k = await makeKey();
    const proof = await signLeaveProof(k.privJwk, "ROOM", "VICTIM", 1000);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "IMPOSTOR", 1000, 1000)).toBe(
      false,
    );
  });

  it("a proof with a stale timestamp (11 minutes old) does not verify", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signLeaveProof(k.privJwk, "ROOM", "MEM", now - 11 * 60_000);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "MEM", proof.ts, now)).toBe(false);
  });

  it("a proof from the future (11 minutes ahead) does not verify", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signLeaveProof(k.privJwk, "ROOM", "MEM", now + 11 * 60_000);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "MEM", proof.ts, now)).toBe(false);
  });

  it("a proof exactly at the ±10-minute boundary still verifies", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const old = await signLeaveProof(k.privJwk, "ROOM", "MEM", now - LEAVE_PROOF_TOLERANCE_MS);
    expect(await verifyLeaveProof(k.pubJwk, old.sig, "ROOM", "MEM", old.ts, now)).toBe(true);
    const future = await signLeaveProof(k.privJwk, "ROOM", "MEM", now + LEAVE_PROOF_TOLERANCE_MS);
    expect(await verifyLeaveProof(k.pubJwk, future.sig, "ROOM", "MEM", future.ts, now)).toBe(true);
  });

  it("malformed base64 fails without throwing", async () => {
    const k = await makeKey();
    expect(
      await verifyLeaveProof(k.pubJwk, "not!!valid@@base64", "ROOM", "MEM", 1000, 1000),
    ).toBe(false);
  });

  it("a non-JWK public key fails without throwing", async () => {
    const k = await makeKey();
    const proof = await signLeaveProof(k.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyLeaveProof({ nope: true }, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(
      false,
    );
    expect(await verifyLeaveProof("a string", proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
    expect(await verifyLeaveProof(null, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });

  it("replaying the same {ts, sig} a second time still verifies — accepted by design", async () => {
    // WHY this is acceptable: a leave is idempotent. Re-leaving an
    // already-inactive member is a no-op that bumps the epoch at most
    // once per window, and nuisance rotation requires a VALID signature
    // from the victim's own key. A captured proof only ever removes
    // the victim, which their own leave button does anyway.
    const k = await makeKey();
    const proof = await signLeaveProof(k.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(true);
    expect(await verifyLeaveProof(k.pubJwk, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(true);
  });
});
