// THE ROTATION VERSION POLICY
//
// A key version used to be a plain counter: the next number above the
// one the client held. Two members falling back at the same time could
// land on the same number, install two different keys under it, and
// read nothing of each other afterwards. The receiver only accepts a
// version strictly greater than the one it holds, so the second offer
// was ignored and the room split in two.
//
// A version is a pair now: the server's rotation epoch, and a fresh
// random offset inside that epoch. The pair compares as one number, so
// a later epoch always wins, and two rotations inside one epoch land
// on two different numbers.
//
// The residual: two rotations in the same epoch that draw the same
// 32-bit offset would still collide. That is one in four billion, and
// it is the price of not asking the server for every version.

import { describe, it, expect } from "vitest";
import { ROTATION_VERSION_SPAN, rotationEpochOf, rotationVersion } from "@/lib/protocol";
import { makeRoom, randomAesKey } from "./helpers";

const ROOM = "ROTVER";

describe("the rotation version policy", () => {
  it("a version is an epoch and an offset, and it compares as one number", () => {
    expect(rotationVersion(0, 5)).toBe(5);
    expect(rotationVersion(1, 0)).toBe(ROTATION_VERSION_SPAN);
    expect(rotationVersion(2, 1)).toBeGreaterThan(rotationVersion(1, 999999));
    expect(rotationEpochOf(rotationVersion(3, 17))).toBe(3);
    expect(rotationEpochOf(5)).toBe(0);
  });

  it("two members rotating at the same epoch land on different versions", async () => {
    const entryKey = await randomAesKey();
    // A fresh offset on every call, shared by both ciphers, so the
    // two rotations draw different numbers.
    let counter = 0;
    const [alice, bob] = await makeRoom(ROOM, ["m-alice", "m-bob"], entryKey, {
      randomOffset: () => ++counter,
    });

    await alice.cipher.rotateTo(4, false);
    await bob.cipher.rotateTo(4, false);

    expect(alice.cipher.kv).not.toBe(bob.cipher.kv);
    // Both sit in the same epoch, so the offset is what separates them.
    expect(rotationEpochOf(alice.cipher.kv)).toBe(4);
    expect(rotationEpochOf(bob.cipher.kv)).toBe(4);
  });

  it("the new version always clears the one held", async () => {
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom(ROOM, ["m-alice"], entryKey);
    const first = alice.cipher.kv;
    await alice.cipher.rotateTo(0, false);
    const second = alice.cipher.kv;
    expect(second).toBeGreaterThan(first);
    await alice.cipher.rotateTo(0, false);
    expect(alice.cipher.kv).toBeGreaterThan(second);
  });

  it("a later epoch always wins over an earlier one", async () => {
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom(ROOM, ["m-alice"], entryKey);
    await alice.cipher.rotateTo(1, false);
    const inEpoch1 = alice.cipher.kv;
    await alice.cipher.rotateTo(9, false);
    expect(rotationEpochOf(alice.cipher.kv)).toBe(9);
    expect(alice.cipher.kv).toBeGreaterThan(inEpoch1);
  });

  it("the server's epoch wins when it is ahead of this client's", async () => {
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom(ROOM, ["m-alice"], entryKey);
    await alice.cipher.rotateTo(0, false);
    expect(rotationEpochOf(alice.cipher.kv)).toBe(0);
    await alice.cipher.rotateTo(12, false);
    expect(rotationEpochOf(alice.cipher.kv)).toBe(12);
  });

  it("a client whose offset sits at the top of its epoch steps into the next one", async () => {
    const entryKey = await randomAesKey();
    // Every draw is the top of the epoch, so the offset can never
    // clear the one held.
    const [alice] = await makeRoom(ROOM, ["m-alice"], entryKey, {
      randomOffset: () => ROTATION_VERSION_SPAN - 1,
    });
    await alice.cipher.rotateTo(3, false);
    const first = alice.cipher.kv;
    expect(rotationEpochOf(first)).toBe(3);
    await alice.cipher.rotateTo(3, false);
    // The next epoch, not the same one with a smaller offset.
    expect(rotationEpochOf(alice.cipher.kv)).toBe(4);
    expect(alice.cipher.kv).toBeGreaterThan(first);
  });

  it("two simultaneous rotations converge on one key (the split brain is gone)", async () => {
    const entryKey = await randomAesKey();
    let counter = 0;
    const [alice, bob] = await makeRoom(ROOM, ["m-alice", "m-bob"], entryKey, {
      randomOffset: () => ++counter,
    });

    // Both fall back at the same epoch, as they do when nobody
    // answered the key request.
    const a = await alice.cipher.rotateTo(4, false);
    const b = await bob.cipher.rotateTo(4, false);
    const aliceHigher = alice.cipher.kv > bob.cipher.kv;
    const fromHigher = aliceHigher ? a[0] : b[0];
    const fromLower = aliceHigher ? b[0] : a[0];

    const accepted = await (aliceHigher ? bob : alice).cipher.open(fromHigher);
    const refused = await (aliceHigher ? alice : bob).cipher.open(fromLower);
    expect(accepted).toMatchObject({ type: "offer-installed" });
    expect(refused.type).toBe("reject");
    expect(alice.cipher.kv).toBe(bob.cipher.kv);

    // Traffic flows under the converged key.
    const msg = await bob.cipher.sealText({ text: "one room again" });
    expect((await alice.cipher.open(msg[0])).type).toBe("text");
  });
});
