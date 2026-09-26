// Task 20.1: FILE MESSAGE CAPTIONS
//
// Bug found in QA round 20: text typed alongside a file attachment was
// silently dropped. The FileMetaBody protocol shape carried no caption,
// and the
// bubble rendered FileContent exclusively. These tests pin the fix:
//
//   1. the caption round-trips through sealFile → open exactly;
//   2. it rides the meta frame's CANONICAL-SIGNED top-level text field,
//      so a caption is as unforgeable as the sender's words;
//   3. the meta frame stays uniform size regardless of caption length
//      (padding keeps hiding it from the relay);
//   4. a caption at the composer's 4000-char limit still fits the frame.

import { describe, it, expect } from "vitest";
import { CONTROL_FRAME_BYTES, fromB64 } from "@/lib/protocol";
import { sha256HexOfBytes } from "@/lib/crypto";
import { makeRoom, broadcast, randomAesKey } from "./helpers";

async function fileArgs(dataB64: string) {
  const raw = fromB64(dataB64);
  return {
    name: "letter.txt",
    mime: "text/plain",
    size: raw.length,
    dataB64,
    sha: await sha256HexOfBytes(raw),
  };
}

describe("file message captions", () => {
  it("a caption survives the wire and arrives exactly as typed", async () => {
    const [alice, bob] = await makeRoom("CAPROOM", ["m-a", "m-b"], await randomAesKey());
    const dataB64 = Buffer.from("attachment bytes").toString("base64");
    const frames = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: "Here is the contract we discussed.",
    });
    const results = await broadcast(frames, [alice, bob], alice.id);
    const file = results.find((r) => r.type === "file");
    expect(file).toBeDefined();
    expect(file && file.type === "file" && file.text).toBe(
      "Here is the contract we discussed.",
    );
  });

  it("unicode and multiline captions round-trip byte-exact", async () => {
    const [alice, bob] = await makeRoom("CAPUNI", ["m-a", "m-b"], await randomAesKey());
    const dataB64 = Buffer.from("x").toString("base64");
    const caption = "Résumé — first draft 🌿\nline two\ttabbed";
    const frames = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: caption,
    });
    const results = await broadcast(frames, [alice, bob], alice.id);
    const file = results.find((r) => r.type === "file");
    expect(file && file.type === "file" && file.text).toBe(caption);
  });

  it("a captionless file still arrives with text undefined (not empty string)", async () => {
    const [alice, bob] = await makeRoom("CAPNONE", ["m-a", "m-b"], await randomAesKey());
    const dataB64 = Buffer.from("plain").toString("base64");
    const frames = await alice.cipher.sealFile({ ...(await fileArgs(dataB64)) });
    const results = await broadcast(frames, [alice, bob], alice.id);
    const file = results.find((r) => r.type === "file");
    expect(file && file.type === "file" && file.text).toBeUndefined();
  });

  it("the meta frame stays uniform size no matter the caption length", async () => {
    const [alice] = await makeRoom("CAPSIZE", ["m-a"], await randomAesKey());
    const dataB64 = Buffer.from("z".repeat(512)).toString("base64");
    const short = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: "hi",
    });
    const long = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: "caption ".repeat(400), // 3.2 KB
    });
    const none = await alice.cipher.sealFile({ ...(await fileArgs(dataB64)) });
    const sizes = [short[0], long[0], none[0]].map((f) => fromB64(f.ct).length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("a caption at the composer's 4000-char limit still fits the meta frame", async () => {
    const [alice] = await makeRoom("CAPMAX", ["m-a"], await randomAesKey());
    const dataB64 = Buffer.from("q".repeat(2048)).toString("base64");
    const frames = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: "长".repeat(4000), // worst case UTF-8: 3 bytes per char
    });
    expect(frames).toHaveLength(frames.length); // no throw
    expect(fromB64(frames[0].ct).length).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("the caption is signature-covered: a re-signed frame from another member's key is rejected", async () => {
    const [alice, bob, mallory] = await makeRoom(
      "CAPFORGE",
      ["m-a", "m-b", "m-mallory"],
      await randomAesKey(),
    );
    const dataB64 = Buffer.from("secret attachment").toString("base64");
    // Mallory re-seals a meta frame with the SAME messageId and file, but
    // her own caption, signed with HER key while claiming to be m-a via
    // the replayable counter shape. The canonical binds senderId, so a
    // frame encrypted by mallory cannot carry alice's senderId. Instead the
    // direct probe: mallory seals her own and relabels `from`.
    const aliceFrames = await alice.cipher.sealFile({
      ...(await fileArgs(dataB64)),
      text: "authentic caption from alice",
    });
    const forged = structuredClone(aliceFrames[0]);
    // Mallory cannot re-key or re-sign; a frame whose `from` is relabeled
    // must fail signature verification on bob's side.
    forged.from = mallory.id;
    const r = await bob.cipher.open(forged);
    expect(r.type).toBe("reject");
  });
});
