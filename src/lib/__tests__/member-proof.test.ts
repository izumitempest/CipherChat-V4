// MEMBER PROOF-OF-POSSESSION (the member update path)
//
// Property: rewriting a member row that already exists requires a
// valid ECDSA signature from that member's OWN registered key. The
// roster is public, so anybody can read a member's pubkey and post it
// back. Before this proof, that post reactivated the member and
// replaced its ECDH key, and the ECDH key is what a key offer is
// encrypted to, so the room key went to whoever posted last.
//
// The proof names the ECDH key being written. A captured proof
// therefore cannot be replayed onto an attacker's ECDH key, which is
// the whole prize.

import { describe, it, expect } from "vitest";
import {
  MEMBER_PROOF_TOLERANCE_MS,
  memberProofInput,
  signMemberProof,
  verifyMemberProof,
} from "@/lib/member-proof";
import { signLeaveProof, verifyLeaveProof } from "@/lib/leave-proof";

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

const ECDH_A = "BASE64-ECDH-KEY-A";
const ECDH_B = "BASE64-ECDH-KEY-B";

describe("member proof-of-possession", () => {
  it("signs and verifies the exact canonical string", async () => {
    expect(memberProofInput("ROOM", ECDH_A, 123)).toBe(`cc-member-v1:ROOM:${ECDH_A}:123`);
    const k = await makeKey();
    const proof = await signMemberProof(k.privJwk, "ROOM", ECDH_A, 123);
    expect(proof.ts).toBe(123);
    expect(proof.sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(await verifyMemberProof(k.pubJwk, proof.sig, "ROOM", ECDH_A, 123, 123)).toBe(true);
  });

  it("a signature by a DIFFERENT key does not verify", async () => {
    const a = await makeKey();
    const b = await makeKey();
    const proof = await signMemberProof(b.privJwk, "ROOM", ECDH_A, 1000);
    expect(await verifyMemberProof(a.pubJwk, proof.sig, "ROOM", ECDH_A, 1000, 1000)).toBe(false);
  });

  it("a captured proof cannot be replayed onto ANOTHER ECDH key", async () => {
    // The attack this closes: the attacker posts the victim's pubkey
    // with the ATTACKER's ECDH key, so the next key offer is
    // encrypted to the attacker. The proof names the ECDH key, so the
    // captured signature does not fit the attacker's key.
    const victim = await makeKey();
    const proof = await signMemberProof(victim.privJwk, "ROOM", ECDH_A, 1000);
    expect(await verifyMemberProof(victim.pubJwk, proof.sig, "ROOM", ECDH_B, 1000, 1000)).toBe(
      false,
    );
  });

  it("a proof for another room does not verify", async () => {
    const k = await makeKey();
    const proof = await signMemberProof(k.privJwk, "ROOM", ECDH_A, 1000);
    expect(await verifyMemberProof(k.pubJwk, proof.sig, "OTHER", ECDH_A, 1000, 1000)).toBe(false);
  });

  it("a stale timestamp does not verify", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signMemberProof(
      k.privJwk,
      "ROOM",
      ECDH_A,
      now - MEMBER_PROOF_TOLERANCE_MS - 60_000,
    );
    expect(await verifyMemberProof(k.pubJwk, proof.sig, "ROOM", ECDH_A, proof.ts, now)).toBe(false);
  });

  it("a proof from the future does not verify", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signMemberProof(
      k.privJwk,
      "ROOM",
      ECDH_A,
      now + MEMBER_PROOF_TOLERANCE_MS + 60_000,
    );
    expect(await verifyMemberProof(k.pubJwk, proof.sig, "ROOM", ECDH_A, proof.ts, now)).toBe(false);
  });

  it("a proof exactly at the window boundary still verifies", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const old = await signMemberProof(k.privJwk, "ROOM", ECDH_A, now - MEMBER_PROOF_TOLERANCE_MS);
    expect(await verifyMemberProof(k.pubJwk, old.sig, "ROOM", ECDH_A, old.ts, now)).toBe(true);
    const future = await signMemberProof(
      k.privJwk,
      "ROOM",
      ECDH_A,
      now + MEMBER_PROOF_TOLERANCE_MS,
    );
    expect(await verifyMemberProof(k.pubJwk, future.sig, "ROOM", ECDH_A, future.ts, now)).toBe(true);
  });

  it("the window is a day, so a device with a wrong clock is not locked out", () => {
    // A ten-minute window here would lock a member out of their own
    // room over a wrong clock. The proof names the ECDH key, so the
    // long window costs almost nothing.
    expect(MEMBER_PROOF_TOLERANCE_MS).toBe(24 * 60 * 60_000);
  });

  it("malformed base64 and non-JWK pubkeys fail without throwing", async () => {
    const k = await makeKey();
    const proof = await signMemberProof(k.privJwk, "ROOM", ECDH_A, 1000);
    expect(
      await verifyMemberProof(k.pubJwk, "not!!valid@@base64", "ROOM", ECDH_A, 1000, 1000),
    ).toBe(false);
    expect(await verifyMemberProof({ nope: true }, proof.sig, "ROOM", ECDH_A, 1000, 1000)).toBe(
      false,
    );
    expect(await verifyMemberProof(null, proof.sig, "ROOM", ECDH_A, 1000, 1000)).toBe(false);
    expect(await verifyMemberProof(k.pubJwk, proof.sig, "ROOM", "", 1000, 1000)).toBe(false);
  });

  it("domain separation: a LEAVE proof never verifies as a MEMBER proof", async () => {
    // Same key, same room, same ts. Only the domain prefix and the
    // field shape differ. A captured departure proof must not rewrite
    // a member row.
    const k = await makeKey();
    const leave = await signLeaveProof(k.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyMemberProof(k.pubJwk, leave.sig, "ROOM", ECDH_A, 1000, 1000)).toBe(false);
    // ... and a member proof is not a departure proof either.
    const member = await signMemberProof(k.privJwk, "ROOM", ECDH_A, 1000);
    expect(await verifyLeaveProof(k.pubJwk, member.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });
});
