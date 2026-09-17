// Task 20.2 — INK REACTIONS (encrypted margin marks)
//
// Property: a mark on a message is as authentic as the words it
// annotates. The mark glyph rides the canonical-signed top-level text
// field; the target rides the canonical-signed messageId field. Frames
// are uniform control size, so the relay cannot even tell that a mark
// happened — let alone which mark, or on what.

import { describe, it, expect } from "vitest";
import { CONTROL_FRAME_BYTES, fromB64 } from "@/lib/protocol";
import { makeRoom, broadcast, randomAesKey } from "./helpers";

describe("ink marks on the wire", () => {
  it("a mark round-trips: sender, target and glyph arrive exact", async () => {
    const [alice, bob] = await makeRoom("REACT1", ["m-a", "m-b"], await randomAesKey());
    const textFrames = await alice.cipher.sealText({ text: "the letter to be marked" });
    const results1 = await broadcast(textFrames, [alice, bob], alice.id);
    const text = results1.find((r) => r.type === "text");
    expect(text).toBeDefined();

    const reactFrames = await bob.cipher.sealReact("target-1", "✦");
    const results2 = await broadcast(reactFrames, [alice, bob], bob.id);
    const react = results2.find((r) => r.type === "react");
    expect(react).toBeDefined();
    if (react && react.type === "react") {
      expect(react.senderId).toBe("m-b");
      expect(react.messageId).toBe("target-1");
      expect(react.mark).toBe("✦");
    }
  });

  it("all four marks travel; arbitrary glyph strings are rejected on open", async () => {
    const [alice, bob] = await makeRoom("REACT2", ["m-a", "m-b"], await randomAesKey());
    for (const mark of ["✓", "✦", "♥", "☾"]) {
      const frames = await alice.cipher.sealReact("msg-x", mark);
      const results = await broadcast(frames, [alice, bob], alice.id);
      const r = results.find((x) => x.type === "react");
      expect(r && r.type === "react" && r.mark).toBe(mark);
    }
    // A crafted frame carrying an arbitrary string: the open-side shape
    // gate must reject anything outside the four product glyphs.
    const evil = await alice.cipher.sealReact("msg-x", "<script>" as never);
    const results = await broadcast(evil, [alice, bob], alice.id);
    expect(results.some((x) => x.type === "react")).toBe(false);
    expect(results.some((x) => x.type === "reject")).toBe(true);
  });

  it("a react frame is indistinguishable in size from a text message", async () => {
    const [alice] = await makeRoom("REACT3", ["m-a"], await randomAesKey());
    const text = await alice.cipher.sealText({ text: "some message of some length" });
    const react = await alice.cipher.sealReact("msg-1", "✓");
    const typing = await alice.cipher.sealTyping();
    const sizes = [...text, ...react, ...typing].map((f) => fromB64(f.ct).length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("a relabeled react frame fails the signature check (cannot impersonate)", async () => {
    const [alice, bob, mallory] = await makeRoom(
      "REACT4",
      ["m-a", "m-b", "m-mallory"],
      await randomAesKey(),
    );
    const frames = await alice.cipher.sealReact("msg-1", "♥");
    const forged = structuredClone(frames[0]);
    forged.from = mallory.id;
    const r = await bob.cipher.open(forged);
    expect(r.type).toBe("reject");
  });

  it("replayed react frames are refused by the replay guard", async () => {
    const [alice, bob] = await makeRoom("REACT5", ["m-a", "m-b"], await randomAesKey());
    const frames = await alice.cipher.sealReact("msg-1", "✓");
    const first = await bob.cipher.open(frames[0]);
    expect(first.type).toBe("react");
    const again = await bob.cipher.open(structuredClone(frames[0]));
    expect(again.type).toBe("reject");
  });
});
