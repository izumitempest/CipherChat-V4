// THE JOIN PROOF
//
// Property: the server can tell a password holder from somebody
// holding only the link. It never sees the password and cannot derive
// the room key. It holds a verifier instead: an HMAC over the key
// derivation output, bound to the room, in a column it does not
// publish. The client proves knowledge by HMAC-ing a timestamp and a
// nonce with that verifier.
//
// The proof is fresh (a timestamp and a nonce), it expires in ten
// minutes, and a captured one cannot be replayed later. The verifier
// is bound to one room, so it cannot be carried to another.
//
// See bugs/BUGS.md B7 and B8.

import { describe, it, expect } from "vitest";
import {
  JOIN_PROOF_WINDOW_MS,
  decodeJoinProof,
  encodeJoinProof,
  joinProofInput,
  joinVerifierFromRaw,
  makeJoinProof,
  verifyJoinProof,
} from "@/lib/join-proof";

async function rawBytes(seed: number): Promise<Uint8Array> {
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = (seed + i * 7) & 0xff;
  return out;
}

describe("the join proof", () => {
  it("the verifier is bound to the room", async () => {
    const raw = await rawBytes(1);
    const inRoomA = await joinVerifierFromRaw(raw, "ROOM-A");
    const inRoomB = await joinVerifierFromRaw(raw, "ROOM-B");
    expect(inRoomA).not.toBe(inRoomB);
  });

  it("a proof made with the room verifier verifies", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(2), "ROOM");
    const proof = await makeJoinProof(verifier, "ROOM", 1_700_000_000_000, "abc123");
    expect(await verifyJoinProof(verifier, encodeJoinProof(proof), "ROOM", 1_700_000_000_000)).toBe(
      true,
    );
  });

  it("a proof made for another room does not verify", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(3), "ROOM-A");
    const proof = await makeJoinProof(verifier, "ROOM-A", 1_700_000_000_000, "abc123");
    // Same verifier, different room.
    expect(await verifyJoinProof(verifier, encodeJoinProof(proof), "ROOM-B", 1_700_000_000_000)).toBe(
      false,
    );
  });

  it("a proof made with another verifier does not verify", async () => {
    const mine = await joinVerifierFromRaw(await rawBytes(4), "ROOM");
    const theirs = await joinVerifierFromRaw(await rawBytes(5), "ROOM");
    const proof = await makeJoinProof(theirs, "ROOM", 1_700_000_000_000, "abc123");
    expect(await verifyJoinProof(mine, encodeJoinProof(proof), "ROOM", 1_700_000_000_000)).toBe(
      false,
    );
  });

  it("a stale proof does not verify", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(6), "ROOM");
    const now = 1_700_000_000_000;
    const proof = await makeJoinProof(
      verifier,
      "ROOM",
      now - JOIN_PROOF_WINDOW_MS - 60_000,
      "abc123",
    );
    expect(await verifyJoinProof(verifier, encodeJoinProof(proof), "ROOM", now)).toBe(false);
  });

  it("a proof from the future does not verify", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(7), "ROOM");
    const now = 1_700_000_000_000;
    const proof = await makeJoinProof(
      verifier,
      "ROOM",
      now + JOIN_PROOF_WINDOW_MS + 60_000,
      "abc123",
    );
    expect(await verifyJoinProof(verifier, encodeJoinProof(proof), "ROOM", now)).toBe(false);
  });

  it("a proof exactly at the window boundary still verifies", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(8), "ROOM");
    const now = 1_700_000_000_000;
    const old = await makeJoinProof(verifier, "ROOM", now - JOIN_PROOF_WINDOW_MS, "abc123");
    expect(await verifyJoinProof(verifier, encodeJoinProof(old), "ROOM", now)).toBe(true);
  });

  it("two proofs never match, so one cannot be replayed as the other", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(9), "ROOM");
    const ts = 1_700_000_000_000;
    const a = await makeJoinProof(verifier, "ROOM", ts, "nonce-a");
    const b = await makeJoinProof(verifier, "ROOM", ts, "nonce-b");
    expect(encodeJoinProof(a)).not.toBe(encodeJoinProof(b));
    // ...and the MAC of one does not verify under the other's nonce.
    expect(await verifyJoinProof(verifier, encodeJoinProof(a), "ROOM", ts)).toBe(true);
    const swapped = { ...a, nonce: b.nonce };
    expect(await verifyJoinProof(verifier, encodeJoinProof(swapped), "ROOM", ts)).toBe(false);
  });

  it("nothing verifies without a stored verifier", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(10), "ROOM");
    const proof = await makeJoinProof(verifier, "ROOM", 1_700_000_000_000, "abc123");
    expect(await verifyJoinProof(null, encodeJoinProof(proof), "ROOM", 1_700_000_000_000)).toBe(
      false,
    );
    expect(await verifyJoinProof("", encodeJoinProof(proof), "ROOM", 1_700_000_000_000)).toBe(false);
  });

  it("malformed proofs fail without throwing", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(11), "ROOM");
    for (const raw of [
      null,
      "",
      "not-a-proof",
      "1.2",
      "a.b.c",
      "1700000000000.nonce.",
      "1700000000000.nonce.not-base64!!",
    ]) {
      expect(await verifyJoinProof(verifier, raw, "ROOM", 1_700_000_000_000)).toBe(false);
    }
  });

  it("the wire form round-trips", async () => {
    const verifier = await joinVerifierFromRaw(await rawBytes(12), "ROOM");
    const proof = await makeJoinProof(verifier, "ROOM", 1_700_000_000_000, "abc123");
    const decoded = decodeJoinProof(encodeJoinProof(proof));
    expect(decoded?.ts).toBe(proof.ts);
    expect(decoded?.nonce).toBe(proof.nonce);
    expect(decoded?.mac).toBe(proof.mac);
    expect(decodeJoinProof("nope")).toBeNull();
  });

  it("the canonical strings are what they say", () => {
    expect(joinProofInput("ROOM", 5, "abc")).toBe("cc-join-proof-v1:ROOM:5:abc");
  });
});
