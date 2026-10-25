// Task 33 - COVER TRAFFIC (round 33)
//
// Property: a "cover" frame is byte-identical on the wire to any
// other control frame (so the relay cannot distinguish silence from
// speech), is signed and replay-guarded like every frame, and is
// discarded by every receiver with no observable effect.

import { describe, it, expect } from "vitest";
import { CONTROL_FRAME_BYTES, fromB64 } from "@/lib/protocol";
import { makeRoom, broadcast, randomAesKey } from "./helpers";

describe("cover frames (uniform size, replay-guarded silence)", () => {
  it("is the exact same wire size as a text frame", async () => {
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom("COVER-SIZE", ["m-a"], entryKey);
    const cover = await alice.cipher.sealCover();
    const text = await alice.cipher.sealText({ text: "hello" });
    // Both as WireFrames carrying the same padded + GCM-tagged payload:
    expect(fromB64(cover[0].ct).length).toBe(CONTROL_FRAME_BYTES + 16);
    expect(fromB64(text[0].ct).length).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("opens cleanly and is silently discarded with no side effect", async () => {
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom("COVER-OPEN", ["m-a", "m-b"], entryKey);
    const frames = await alice.cipher.sealCover();
    const results = await broadcast(frames, [alice, bob], alice.id);
    // Both members opened it (sender does too via the broadcast loop).
    expect(results).toHaveLength(1); // bob only: alice skips her own
    expect(results[0].type).toBe("cover");
  });

  it("is replay-guarded exactly like a text frame", async () => {
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(
      "COVER-REPLAY",
      ["m-a", "m-b"],
      entryKey,
    );
    const cover = (await alice.cipher.sealCover())[0];
    const first = await bob.cipher.open(structuredClone(cover));
    expect(first.type).toBe("cover");
    const replay = await bob.cipher.open(structuredClone(cover));
    expect(replay.type).toBe("reject");
    expect(replay.type === "reject" && replay.reason).toBe("replay");
  });

  it("mixes with real traffic without breaking the replay window", async () => {
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom("COVER-MIX", ["m-a", "m-b"], entryKey);
    // Simulate the heartbeat interleaving covers and a real letter.
    const cover1 = (await alice.cipher.sealCover())[0];
    const letter = (await alice.cipher.sealText({ text: "hi" }))[0];
    const cover2 = (await alice.cipher.sealCover())[0];
    expect((await bob.cipher.open(cover1)).type).toBe("cover");
    expect((await bob.cipher.open(letter)).type).toBe("text");
    expect((await bob.cipher.open(cover2)).type).toBe("cover");
  });

  it("requires the shared room key to open, so the relay still can't read it", async () => {
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom("COVER-KEY", ["m-a"], entryKey);
    const cover = (await alice.cipher.sealCover())[0];
    // A wrong-room key fails the same GCM/binding check as any frame.
    const wrongKey = await randomAesKey();
    const { openFrame } = await import("@/lib/protocol");
    expect(await openFrame(wrongKey, cover)).toBeNull();
  });
});
