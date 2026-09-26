// Task 19.2: REAL KEY ROTATION ON LEAVE (P0)
//
// Property: when a member leaves, the remaining members encrypt the room
// under a NEW RANDOM key, delivered pairwise over ephemeral ECDH and
// signed. The departed member holds the password, the room id, a live
// socket, and can read the key version from the plain frame metadata,
// and STILL cannot decrypt any post-rotation frame. Password knowledge is not enough,
// because the new key is not derived from the password.
//
// Additional properties: forged rotation offers (from a
// non-coordinator) are rejected; offers carrying stale key versions
// are rejected; frames encrypted under the old key keep decrypting
// briefly (grace window) but are refused after it closes; frames from
// the departed member are refused outright (registry eviction).

import { describe, it, expect } from "vitest";
import { makeRoom, broadcast, randomAesKey } from "./helpers";
import { KEY_GRACE_MS } from "@/lib/protocol";

describe("ACCEPTANCE — the departed member cannot read the room after rotation", () => {
  it("Mallory leaves, keeps password + roomId + live pipeline, and cannot decrypt post-rotation frames", async () => {
    const roomId = "ROTROOM";
    let now = Date.now();
    // Everyone derived the same entry key from the same password:
    const entryKey = await randomAesKey();
    const [alice, bob, mallory] = await makeRoom(roomId, ["m-alice", "m-bob", "m-mallory"], entryKey, { now: () => now });

    // Pre-rotation: Mallory can read the room (she is a member).
    const before = await alice.cipher.sealText({ text: "before rotation" });
    for (const f of before) {
      expect((await mallory.cipher.open(f)).type).toBe("text");
    }

    // Mallory leaves: every remaining member's registry drops her.
    for (const m of [alice, bob]) m.cipher.registry.delete("m-mallory");
    // (Mallory keeps HER registry: she still sees everyone's keys,
    //  the room id, and her own in-memory password-derived entry key.)

    // The deterministic coordinator (lowest memberId among remaining)
    // rotates: generates a RANDOM new key and delivers it pairwise.
    const offerFrames = await alice.cipher.rotateAsCoordinator();
    expect(offerFrames.length).toBe(1); // one offer, addressed to Bob
    expect(offerFrames[0].to).toBe("m-bob");

    // The relay broadcasts everything; Mallory receives the offer too.
    const results = await broadcast(offerFrames, [alice, bob, mallory], "m-alice");
    // Bob installed the new key:
    expect(results[0]).toMatchObject({ type: "offer-installed", rotation: true });
    expect(bob.cipher.kv).toBe(2);
    // Mallory did NOT (offer addressed to Bob; ECDH pair is Alice↔Bob):
    expect(results[1].type).toBe("reject");
    expect(mallory.cipher.kv).toBe(1);

    // Post-rotation traffic: Mallory sees the frames (kv: 2 in the
    // clear) but cannot decrypt a single one. Fresh kv-2 frames are
    // held briefly (a legitimate member may be one key-offer behind);
    // they NEVER decrypt, and once the pending window passes they are
    // refused outright:
    const after = await alice.cipher.sealText({ text: "after rotation — secret" });
    for (const f of after) {
      const seen = await mallory.cipher.open(f);
      expect(seen.type === "reject" || seen.type === "pending").toBe(true);
      expect(seen.type).not.toBe("text");
      // ...while Bob reads fine:
      expect((await bob.cipher.open(f)).type).toBe("text");
    }
    now += 6000; // pending window over
    for (const f of after) {
      const expired = await mallory.cipher.open(f);
      expect(expired.type).toBe("reject");
      if (expired.type === "reject") expect(expired.reason).toBe("kv");
    }

    // Mallory cannot re-enter by re-deriving from the password: her
    // entry key is version 1; the room is on version 2, and the v2
    // key was NEVER derived from the password.
    expect(mallory.cipher.getKey(2)).toBeUndefined();
  });

  it("Mallory cannot inject into the rotated room (registry eviction)", async () => {
    const roomId = "ROTROOM2";
    const entryKey = await randomAesKey();
    const [alice, bob, mallory] = await makeRoom(roomId, ["m-alice", "m-bob", "m-mallory"], entryKey);

    for (const m of [alice, bob]) m.cipher.registry.delete("m-mallory");
    const offers = await alice.cipher.rotateAsCoordinator();
    await broadcast(offers, [alice, bob, mallory], "m-alice");

    // Mallory still holds her signing key and the OLD room key. She
    // forges traffic "from herself" under kv 1:
    const injected = await mallory.cipher.sealText({ text: "ghost of me" });
    const rAlice = await alice.cipher.open(injected[0]);
    expect(rAlice.type).toBe("reject");
    if (rAlice.type === "reject") expect(rAlice.reason).toBe("registry");
    const rBob = await bob.cipher.open(injected[0]);
    expect(rBob.type).toBe("reject");
  });
});

describe("rotation ceremony hardening", () => {
  it("a rotation offer from a NON-coordinator is rejected", async () => {
    const roomId = "ROTROOM3";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Bob (memberId m-bob is NOT the coordinator; m-alice sorts first)
    // forges a rotation offer by hand (a malicious client would not use
    // the guarded helper):
    const rogueOffers = await bob.cipher.sealKeyOffer({
      to: "m-alice",
      kv: 2,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: true,
    });
    expect(rogueOffers.length).toBe(1);
    const r = await alice.cipher.open(rogueOffers[0]);
    expect(r.type).toBe("reject");
    if (r.type === "reject") expect(r.reason).toBe("offer");
    expect(alice.cipher.kv).toBe(1); // nothing installed
  });

  it("an offer carrying a stale key version is rejected", async () => {
    const roomId = "ROTROOM4";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Legitimate rotation to kv 2:
    const offers = await alice.cipher.rotateAsCoordinator();
    await bob.cipher.open(offers[0]);
    expect(bob.cipher.kv).toBe(2);

    // A replayed/stale offer claiming kv 2 again (or lower) installs nothing:
    const stale = await alice.cipher.sealKeyOffer({
      to: "m-bob",
      kv: 2,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: true,
    });
    const r = await bob.cipher.open(stale[0]);
    expect(r.type).toBe("reject");
    expect(bob.cipher.kv).toBe(2);
  });

  it("an offer whose ECDH key does not match the sender's registered key is rejected (UKS defense)", async () => {
    const roomId = "ROTROOM5";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Alice is coordinator, but she wraps the offer under a DIFFERENT
    // ECDH key than the one Bob has registered for her:
    const rogueEcdh = await import("@/lib/protocol").then((m) => m.generateSessionEcdh());
    const offers = await alice.cipher.sealKeyOffer({
      to: "m-bob",
      kv: 2,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: true,
      overrideEcdh: rogueEcdh,
    });
    const r = await bob.cipher.open(offers[0]);
    expect(r.type).toBe("reject");
    expect(bob.cipher.kv).toBe(1);
  });

  it("in-flight frames under the old key survive a short grace window, then are refused", async () => {
    const roomId = "ROTROOM6";
    const entryKey = await randomAesKey();
    let now = Date.now();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey, { now: () => now });

    // Bob seals a frame under kv 1 (he has not rotated yet).
    const inFlight = await bob.cipher.sealText({ text: "in flight" });

    // Alice rotates; Bob installs the new key.
    const offers = await alice.cipher.rotateAsCoordinator();
    await bob.cipher.open(offers[0]);
    expect(bob.cipher.kv).toBe(2);

    // The in-flight kv-1 frame arrives AFTER rotation; grace saves it:
    const during = await bob.cipher.open(inFlight[0]);
    expect(during.type).toBe("text");

    // After the grace window closes, old-key frames are refused:
    now += KEY_GRACE_MS + 1000;
    const late = await bob.cipher.open(inFlight[0]);
    expect(late.type).toBe("reject");
  });

  it("eviction survives a full-room refresh (the server's epoch ledger)", async () => {
    const roomId = "ROTREFRESH";
    let now = Date.now();
    const entryKey = await randomAesKey();
    const [alice, bob, mallory] = await makeRoom(roomId, ["m-alice", "m-bob", "m-mallory"], entryKey, { now: () => now });

    // Mallory leaves; Alice (coordinator) rotates to kv 2. The server's
    // epoch ledger now reads 2 (it persists; the key does not).
    for (const m of [alice, bob]) m.cipher.registry.delete("m-mallory");
    const offers1 = await alice.cipher.rotateAsCoordinator();
    await bob.cipher.open(offers1[0]);
    expect(bob.cipher.kv).toBe(2);

    // EVERY remaining member refreshes: fresh ciphers, same entry key,
    // kv back at 1. Mallory keeps her live session, holding the
    // password, kv1, AND kv2.
    const [alice2, bob2] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey, { now: () => now });

    // The ledger says epoch 2 → the coordinator rotates PAST it:
    const offers2 = await alice2.cipher.rotateAsCoordinator(2);
    expect(alice2.cipher.kv).toBe(3);
    expect(offers2.length).toBe(1);
    const r = await bob2.cipher.open(offers2[0]);
    expect(r).toMatchObject({ type: "offer-installed", rotation: true });
    expect(bob2.cipher.kv).toBe(3);

    // Mallory, with password, roomId, live pipeline, kv1 + kv2, cannot
    // read the post-refresh traffic:
    const secret = await alice2.cipher.sealText({ text: "after the refresh" });
    const seen = await mallory.cipher.open(secret[0]);
    expect(seen.type === "reject" || seen.type === "pending").toBe(true);
    expect(seen.type).not.toBe("text");
    now += 6000; // pending window over
    const expired = await mallory.cipher.open(secret[0]);
    expect(expired.type).toBe("reject");

    // ...while the refreshed members read fine:
    expect((await bob2.cipher.open(secret[0])).type).toBe("text");
  });

  it("simultaneous fallback re-seals converge (no split brain)", async () => {
    const roomId = "ROTCONV";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Both members stale at kv 1 (everyone refreshed, nobody answered
    // the key request). Both fall back with member-initiated offers
    // (rot=false) and randomized version jumps:
    const a = await alice.cipher.rotateTo(4, false); // alice lands on kv 5
    const b = await bob.cipher.rotateTo(7, false); // bob lands on kv 8
    expect(alice.cipher.kv).toBe(5);
    expect(bob.cipher.kv).toBe(8);

    // Each receives the other's offer. It is encrypted under the entry
    // key, so readable by any password holder at any version:
    const ra = await alice.cipher.open(b[0]); // kv 8 > 5 → installs
    const rb = await bob.cipher.open(a[0]); // kv 5 < 8 → ignored
    expect(ra).toMatchObject({ type: "offer-installed" });
    expect(rb.type).toBe("reject");
    expect(alice.cipher.kv).toBe(8);
    expect(bob.cipher.kv).toBe(8);

    // Traffic flows under the converged key:
    const msg = await bob.cipher.sealText({ text: "converged" });
    expect((await alice.cipher.open(msg[0])).type).toBe("text");
  });

  it("an offer carrying an absurd key version is rejected (no version brick)", async () => {
    const roomId = "ROTCAP";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // A malicious member pushes a chosen key at kv 2^53 (beyond
    // MAX_SAFE_INTEGER). Installing it would make every future
    // rotation compute newKv === kv, bricking the room:
    const huge = await alice.cipher.sealKeyOffer({
      to: "m-bob",
      kv: 2 ** 53,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: false,
    });
    const r1 = await bob.cipher.open(huge[0]);
    expect(r1.type).toBe("reject");
    expect(bob.cipher.kv).toBe(1);

    // Same for an out-of-bound but representable version:
    const big = await alice.cipher.sealKeyOffer({
      to: "m-bob",
      kv: 1_000_000_000,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: false,
    });
    const r2 = await bob.cipher.open(big[0]);
    expect(r2.type).toBe("reject");
    expect(bob.cipher.kv).toBe(1);

    // The room can still rotate normally afterwards:
    const offers = await alice.cipher.rotateAsCoordinator();
    expect((await bob.cipher.open(offers[0])).type).toBe("offer-installed");
    expect(bob.cipher.kv).toBe(2);
  });

  it("parked pending frames expire — a stale undecryptable frame cannot squat the buffer", async () => {
    const roomId = "ROTPEND";
    let now = Date.now();
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey, { now: () => now });

    // Alice rotates; Bob has NOT installed the new key yet.
    const offers = await alice.cipher.rotateAsCoordinator();
    // A post-rotation frame arrives at Bob before the offer:
    const fresh = await alice.cipher.sealText({ text: "waiting for the key" });
    const parked = await bob.cipher.open(fresh[0]);
    expect(parked.type).toBe("pending");

    // Time passes beyond the pending window; the frame is refused:
    now += 6000;
    const expired = await bob.cipher.open(structuredClone(fresh[0]));
    expect(expired.type).toBe("reject");
    if (expired.type === "reject") expect(expired.reason).toBe("kv");
  });

  it("joiners receive the CURRENT key via a double-wrapped offer (password-gated), not by derivation", async () => {
    const roomId = "ROTROOM7";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Room rotates past the password-derived key:
    const offers = await alice.cipher.rotateAsCoordinator();
    await bob.cipher.open(offers[0]);
    expect(bob.cipher.kv).toBe(2);

    // A newcomer with the right password derives the same entry key:
    const [newbie] = await makeRoom(roomId, ["m-new"], entryKey);
    // The room's members appear in the newcomer's registry:
    for (const [id, entry] of alice.cipher.registry) {
      newbie.cipher.registry.set(id, { ...entry });
    }
    // And the newcomer appears in the members' registries, with the
    // SAME signing + ECDH keys the newcomer's cipher actually holds:
    for (const m of [alice, bob]) {
      m.cipher.registry.set("m-new", {
        pubkey: newbie.cipher.sigPubJwk,
        ecdhPubB64: newbie.cipher.ecdh.pubRawB64,
        connected: true,
      });
    }

    // Existing member delivers the current key to the newcomer:
    // ECDH-wrapped AND wrapped under the password-derived entry key:
    const deliver = await alice.cipher.deliverKeyTo("m-new");
    expect(deliver).toHaveLength(1);
    const r = await newbie.cipher.open(deliver[0]);
    expect(r).toMatchObject({ type: "offer-installed", rotation: false });
    expect(newbie.cipher.kv).toBe(2);

    // The newcomer can now read live traffic:
    const live = await bob.cipher.sealText({ text: "welcome" });
    expect((await newbie.cipher.open(live[0])).type).toBe("text");

    // ...but a stranger WITHOUT the password cannot open the delivery,
    // even though the relay handed them the same bytes:
    const [stranger] = await makeRoom(roomId, ["m-stranger"], await randomAesKey());
    for (const [id, entry] of alice.cipher.registry) {
      stranger.cipher.registry.set(id, { ...entry });
    }
    const stolen = await stranger.cipher.open(deliver[0]);
    expect(stolen.type).toBe("reject");
    expect(stranger.cipher.kv).toBe(1);
  });
});
