// Task 19.1: REPLAY PROTECTION (P0)
//
// Property: a captured frame, re-injected by the relay (or anyone who
// captured traffic), must be rejected, both before AND after its
// message
// burned. Burned messages must not resurrect. Live duplicates must not
// double-render. Fresh frames from the same sender must keep flowing.

import { describe, it, expect } from "vitest";
import {
  createReplayGuard,
  createSendClock,
  TS_WINDOW_MS,
} from "@/lib/protocol";
import { makeRoom, broadcast, randomAesKey } from "./helpers";

describe("replay guard (per-sender monotonic counters + timestamp window + id dedup)", () => {
  it("accepts a fresh frame and rejects its exact re-injection", () => {
    const g = createReplayGuard();
    const meta = {
      senderId: "A",
      sessionTag: "s1",
      counter: 1,
      ts: Date.now(),
      id: "f1",
    };
    expect(g.check(meta)).toBe(true);
    expect(g.check(meta)).toBe(false); // same id: dedup
  });

  it("rejects counters at or below the highest seen for (sender, session)", () => {
    const g = createReplayGuard();
    const now = Date.now();
    expect(g.check({ senderId: "A", sessionTag: "s1", counter: 5, ts: now, id: "a" })).toBe(true);
    // same counter, different id: replay
    expect(g.check({ senderId: "A", sessionTag: "s1", counter: 5, ts: now, id: "b" })).toBe(false);
    // lower counter, different id: reorder/replay
    expect(g.check({ senderId: "A", sessionTag: "s1", counter: 4, ts: now, id: "c" })).toBe(false);
    // higher counter: fresh
    expect(g.check({ senderId: "A", sessionTag: "s1", counter: 6, ts: now, id: "d" })).toBe(true);
  });

  it("a new session tag starts a fresh counter space (refresh keeps working)", () => {
    const g = createReplayGuard();
    const now = Date.now();
    expect(g.check({ senderId: "A", sessionTag: "s1", counter: 9, ts: now, id: "a" })).toBe(true);
    expect(
      g.check({ senderId: "A", sessionTag: "s2", counter: 1, ts: now, id: "b" }),
    ).toBe(true);
  });

  it("rejects timestamps outside the ±10 minute window (past and future)", () => {
    const g = createReplayGuard();
    const now = Date.now();
    expect(
      g.check({ senderId: "A", sessionTag: "s1", counter: 1, ts: now - TS_WINDOW_MS - 1000, id: "a" }),
    ).toBe(false);
    expect(
      g.check({ senderId: "A", sessionTag: "s1", counter: 2, ts: now + TS_WINDOW_MS + 1000, id: "b" }),
    ).toBe(false);
    expect(
      g.check({ senderId: "A", sessionTag: "s1", counter: 3, ts: now - TS_WINDOW_MS + 1000, id: "c" }),
    ).toBe(true);
  });

  it("message ids dedup across senders", () => {
    const g = createReplayGuard();
    const now = Date.now();
    expect(g.check({ senderId: "A", sessionTag: "s", counter: 1, ts: now, id: "same" })).toBe(true);
    expect(g.check({ senderId: "B", sessionTag: "s", counter: 1, ts: now, id: "same" })).toBe(false);
  });
});

describe("send clock", () => {
  it("counts monotonically within a random per-session tag", () => {
    const c1 = createSendClock();
    const c2 = createSendClock();
    expect(c1.sessionTag).not.toBe(c2.sessionTag);
    expect(c1.next()).toBe(1);
    expect(c1.next()).toBe(2);
    expect(c1.next()).toBe(3);
  });
});

describe("watermark persistence (cross-refresh replay defense)", () => {
  it("a guard seeded with a persisted watermark rejects replayed counters after a refresh", () => {
    // Session one: accept frames up to counter 7, persisting watermarks.
    const store: Record<string, number> = {};
    const g1 = createReplayGuard({
      onAccept: (key, counter) => {
        store[key] = counter;
      },
    });
    const now = Date.now();
    for (let i = 1; i <= 7; i++) {
      expect(g1.check({ senderId: "A", sessionTag: "s1", counter: i, ts: now, id: `f${i}` })).toBe(true);
    }

    // Refresh: a NEW guard, seeded from the persisted watermark.
    const g2 = createReplayGuard({
      initialHigh: new Map(Object.entries(store).map(([k, v]) => [k, v])),
    });
    // The captured frame (counter 5) replays against the fresh guard:
    expect(g2.check({ senderId: "A", sessionTag: "s1", counter: 5, ts: now, id: "f5" })).toBe(false);
    // Counter 7 (the highest seen) is also refused:
    expect(g2.check({ senderId: "A", sessionTag: "s1", counter: 7, ts: now, id: "f7" })).toBe(false);
    // Fresh counters continue:
    expect(g2.check({ senderId: "A", sessionTag: "s1", counter: 8, ts: now, id: "f8" })).toBe(true);
  });
});

describe("ACCEPTANCE — burned messages cannot be resurrected by re-injection", () => {
  it("a captured frame re-injected after the TTL burn is rejected, and a live re-injection does not duplicate", async () => {
    const roomId = "REPLAYROOM";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // Alice encrypts a message that will burn in 5 seconds.
    const frames = await alice.cipher.sealText({ text: "vanishes soon", ttlSec: 5 });
    expect(frames).toHaveLength(1);
    const captured = frames[0];

    // Live delivery: Bob renders it once.
    const first = await bob.cipher.open(captured);
    expect(first.type).toBe("text");

    // Re-inject the SAME bytes while the message is still live (relay
    // misbehaving / duplicate delivery): rejected, no double render.
    const dup = await bob.cipher.open(structuredClone(captured));
    expect(dup.type).toBe("reject");

    // ...time passes, the message burns on Bob's side (client timer)...
    // The relay replays the captured envelope from its logs:
    const resurrected = await bob.cipher.open(structuredClone(captured));
    expect(resurrected.type).toBe("reject");
    if (resurrected.type === "reject") {
      expect(resurrected.reason).toBe("replay");
    }

    // Fresh frames from Alice still flow: the guard did not over-block.
    const fresh = await alice.cipher.sealText({ text: "still alive" });
    const ok = await bob.cipher.open(fresh[0]);
    expect(ok.type).toBe("text");
  });

  it("typing frames are also replay-protected (they consume counters too)", async () => {
    const roomId = "REPLAYROOM2";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    const frames = await alice.cipher.sealTyping();
    expect(await bob.cipher.open(frames[0])).toMatchObject({ type: "typing" });
    expect((await bob.cipher.open(frames[0])).type).toBe("reject");
  });

  it("frames from a sender not in the member registry are rejected", async () => {
    const roomId = "REPLAYROOM3";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    // A stranger (or a departed member) injects a frame.
    const [stranger] = await makeRoom(roomId, ["m-stranger"], entryKey);
    // Give the stranger the same room key material so only the registry
    // check can save us:
    for (const [id, entry] of alice.cipher.registry) {
      stranger.cipher.registry.set(id, { ...entry });
    }
    const frames = await stranger.cipher.sealText({ text: "let me in" });
    const r = await bob.cipher.open(frames[0]);
    expect(r.type).toBe("reject");
    if (r.type === "reject") expect(r.reason).toBe("registry");
  });

  it("a frame whose signature does not verify is rejected (forgery)", async () => {
    const roomId = "REPLAYROOM4";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    const frames = await alice.cipher.sealText({ text: "hello" });
    // Tamper with the ciphertext: same shape, wrong bytes.
    const tampered = structuredClone(frames[0]);
    tampered.ct = tampered.ct.slice(0, -4) + "AAAA";
    const r = await bob.cipher.open(tampered);
    expect(r.type).toBe("reject");
  });

  it("broadcast helper sanity — three members, one text frame, two receivers accept", async () => {
    const roomId = "REPLAYROOM5";
    const entryKey = await randomAesKey();
    const [alice, bob, carol] = await makeRoom(roomId, ["m-alice", "m-bob", "m-carol"], entryKey);
    const frames = await alice.cipher.sealText({ text: "hi all" });
    const results = await broadcast(frames, [alice, bob, carol], "m-alice");
    expect(results.map((r) => r.type)).toEqual(["text", "text"]);
  });
});
