// Protocol v3: the canonical signs the whole frame body.
//
// v2 had two bugs. Its signing string glued variable-length fields
// together with "|" and escaped only one of them, so two different
// bodies could produce the same string and a signature made for one
// verified for the other. And it signed only the text and the top
// level file sha, so the ttl, the view-once flag, the file name and
// mime, the file bytes and the key offer contents travelled unsigned.
//
// v3 hashes the whole body instead, so both bugs are gone by
// construction. These tests prove it at the level the product runs
// at: a real frame, re-encrypted by somebody who holds the room key,
// with the sender's own signature still attached.
//
// The attacker modelled here is a member. They know the room key, so
// they can decrypt a frame, change one field, and put it back on the
// wire. What they cannot do is produce a signature that covers the
// changed field. Every case below says: the receiver says no.

import { describe, it, expect } from "vitest";
import {
  CONTROL_FRAME_BYTES,
  FILE_FRAME_BYTES,
  WIRE_VERSION,
  canonicalJson,
  canonicalV3FromBody,
  fromB64,
  openFrame,
  padToSize,
  toB64,
  type FrameBody,
  type WireFrame,
} from "@/lib/protocol";
import { makeRoom, randomAesKey, type TestMember } from "./helpers";

const encoder = new TextEncoder();

/** Re-encrypt a frame's body under the room key with one field
 *  changed, keeping the original signature and the original clock.
 *  This is what a member holding the room key could do. */
async function tamper(
  frame: WireFrame,
  key: CryptoKey,
  size: number,
  patch: (body: FrameBody) => FrameBody,
): Promise<WireFrame> {
  const opened = await openFrame(key, frame);
  if (!opened) throw new Error("frame did not open");
  const body = patch(opened);
  const padded = padToSize(encoder.encode(JSON.stringify(body)), size);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    padded as unknown as BufferSource,
  );
  return {
    ...frame,
    id: crypto.randomUUID(),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

/** The receiver must refuse a re-encrypted frame whose signature no
 *  longer covers the body. */
async function expectRefused(
  bob: TestMember,
  frame: WireFrame,
  key: CryptoKey,
  size: number,
  patch: (body: FrameBody) => FrameBody,
  label: string,
) {
  const forged = await tamper(frame, key, size, patch);
  const result = await bob.cipher.open(forged);
  expect(result.type, label).toBe("reject");
  if (result.type === "reject") {
    expect(result.reason, label).toBe("signature");
  }
}

describe("protocol v3: one canonical, no collisions", () => {
  it("the old collision pair no longer produces the same signing string", async () => {
    // v2 built "...|text|hello|world||" for BOTH of these bodies.
    const a = await canonicalV3FromBody("ROOM", {
      kind: "text",
      senderId: "m-a",
      sessionTag: "t",
      counter: 1,
      ts: 1000,
      kv: 1,
      sig: "",
      text: "hello|world",
      fileSha: "",
    });
    const b = await canonicalV3FromBody("ROOM", {
      kind: "text",
      senderId: "m-a",
      sessionTag: "t",
      counter: 1,
      ts: 1000,
      kv: 1,
      sig: "",
      text: "hello",
      fileSha: "world|",
    });
    expect(a).not.toBe(b);
  });

  it("the old forgery does not verify: a swapped text is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({ text: "hello|world" });

    // The control: the honest frame opens.
    expect((await bob.cipher.open(structuredClone(frame))).type).toBe("text");

    // The forgery that worked on v2: move the pipe from the text into
    // the file sha field. Same signature, different body.
    await expectRefused(
      bob,
      frame,
      key,
      CONTROL_FRAME_BYTES,
      (b) => ({ ...b, text: "hello", fileSha: "world|" }),
      "swapped text and file sha",
    );
  });

  it("the ttl cannot be rewritten under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({ text: "gone in an hour", ttlSec: 3600 });
    expect((await bob.cipher.open(structuredClone(frame))).type).toBe("text");
    await expectRefused(
      bob,
      frame,
      key,
      CONTROL_FRAME_BYTES,
      (b) => ({ ...b, ttlSec: 60 * 60 * 24 * 365 }),
      "ttl extended to a year",
    );
  });

  it("the view-once flag cannot be flipped under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({ text: "look once" });
    await expectRefused(
      bob,
      frame,
      key,
      CONTROL_FRAME_BYTES,
      (b) => ({ ...b, viewOnce: true }),
      "view-once turned on after the fact",
    );
  });

  it("a quote cannot be rewritten under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({
      text: "answering",
      reply: { id: "msg-1", senderId: "m-b", snippet: "what was actually said" },
    });
    await expectRefused(
      bob,
      frame,
      key,
      CONTROL_FRAME_BYTES,
      (b) => ({
        ...b,
        reply: { id: "msg-1", senderId: "m-b", snippet: "what was NOT said" },
      }),
      "quote rewritten",
    );
  });

  it("file metadata cannot be rewritten under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const frames = await alice.cipher.sealFile({
      name: "holiday.jpg",
      mime: "image/jpeg",
      size: 3,
      dataB64: "AAA",
      sha: "f".repeat(64),
      viewOnce: true,
    });
    const meta = frames[0];
    expect(meta).toBeDefined();

    const patches: [string, (b: FrameBody) => FrameBody][] = [
      ["file name", (b) => ({ ...b, file: { ...b.file!, name: "invoice.pdf" } })],
      ["file mime", (b) => ({ ...b, file: { ...b.file!, mime: "application/pdf" } })],
      ["file size", (b) => ({ ...b, file: { ...b.file!, size: 999999 } })],
      ["file hash", (b) => ({ ...b, file: { ...b.file!, sha: "0".repeat(64) } })],
      ["file view-once", (b) => ({ ...b, file: { ...b.file!, viewOnce: false } })],
      ["file ttl", (b) => ({ ...b, file: { ...b.file!, ttlSec: 999999 } })],
    ];
    for (const [label, patch] of patches) {
      await expectRefused(bob, meta, key, CONTROL_FRAME_BYTES, patch, label);
    }
  });

  it("file bytes cannot be swapped under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const frames = await alice.cipher.sealFile({
      name: "note.txt",
      mime: "text/plain",
      size: 3,
      dataB64: "AAA",
      sha: "f".repeat(64),
    });
    const chunk = frames[1];
    expect(chunk).toBeDefined();

    await expectRefused(
      bob,
      chunk,
      key,
      FILE_FRAME_BYTES,
      (b) => ({
        ...b,
        chunk: { ...b.chunk!, dataB64: "BBB" },
      }),
      "chunk bytes swapped",
    );
    await expectRefused(
      bob,
      chunk,
      key,
      FILE_FRAME_BYTES,
      (b) => ({
        ...b,
        chunk: { ...b.chunk!, seq: 7 },
      }),
      "chunk position changed",
    );
  });

  it("key offer contents cannot be rewritten under the sender's signature", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const frames = await alice.cipher.sealKeyOffer({
      to: "m-b",
      kv: 2,
      keyRaw: crypto.getRandomValues(new Uint8Array(32)),
      rot: false,
    });
    const offer = frames[0];
    expect(offer).toBeDefined();

    const patches: [string, (b: FrameBody) => FrameBody][] = [
      ["offer target", (b) => ({ ...b, offer: { ...b.offer!, to: "m-c" } })],
      ["offer key version", (b) => ({ ...b, offer: { ...b.offer!, kv: 9 } })],
      ["offer rotation flag", (b) => ({ ...b, offer: { ...b.offer!, rot: true } })],
      ["offer wrapped key", (b) => ({ ...b, offer: { ...b.offer!, wrapCt: "AAAA" } })],
      ["offer sender key", (b) => ({ ...b, offer: { ...b.offer!, ecdhPubB64: "AAAA" } })],
    ];
    for (const [label, patch] of patches) {
      await expectRefused(bob, offer, key, CONTROL_FRAME_BYTES, patch, label);
    }
  });

  it("a frame from another room is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({ text: "hello" });
    const wrongRoom = { ...frame, roomId: "OTHERROOM" } as WireFrame;
    const result = await bob.cipher.open(wrongRoom);
    expect(result.type).toBe("reject");
  });

  it("a v2 frame is refused, because v2's signing string could not be trusted", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom("ROOM", ["m-a", "m-b"], key);
    const [frame] = await alice.cipher.sealText({ text: "hello" });
    const old = { ...frame, v: 2 } as unknown as WireFrame;
    const result = await bob.cipher.open(old);
    expect(result.type).toBe("reject");
    if (result.type === "reject") {
      expect(result.reason).toBe("shape");
    }
  });

  it("this build speaks v3", () => {
    expect(WIRE_VERSION).toBe(3);
  });
});

describe("canonical JSON", () => {
  it("sorts object keys, so the order a body was built in cannot matter", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1}}');
  });

  it("drops undefined values, the way JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("formats numbers the way JSON does", () => {
    expect(canonicalJson(1)).toBe("1");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(1e21)).toBe("1e+21");
    expect(canonicalJson(Number.NaN)).toBe("null");
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe("null");
  });

  it("escapes strings the way JSON does", () => {
    expect(canonicalJson('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalJson("line\nbreak")).toBe('"line\\nbreak"');
  });
});

describe("base64 helpers still round trip", () => {
  it("bytes survive the trip", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(Array.from(fromB64(toB64(bytes)))).toEqual(Array.from(bytes));
  });
});
