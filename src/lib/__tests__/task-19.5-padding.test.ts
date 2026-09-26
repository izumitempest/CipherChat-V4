// Task 19.5: UNIFORM FRAME PADDING (P1)
//
// Property: the relay cannot distinguish frame kinds by size. Every
// control frame (message, typing, receipt, burn, key offer, file meta)
// is padded to ONE uniform size before encryption. File transfers are
// a fixed number of uniform chunk frames regardless of true file size,
// so the relay cannot read file sizes from the frames it forwards.

import { describe, it, expect } from "vitest";
import {
  padToSize,
  unpadFromSize,
  sealFrame,
  createSendClock,
  CONTROL_FRAME_BYTES,
  FILE_FRAME_BYTES,
  FILE_PAYLOAD_B64,
  FILE_TOTAL_CHUNKS,
  fromB64,
} from "@/lib/protocol";
import { makeRoom, randomAesKey } from "./helpers";
import { sha256HexOfBytes, fromB64 as legacyFromB64 } from "@/lib/crypto";

/** getRandomValues is capped at 64 KiB per call; fill in blocks. */
function randBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, n)));
  }
  return out;
}

describe("pad / unpad primitives", () => {
  it("pads to exactly the requested size and round-trips", () => {
    const input = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const padded = padToSize(input, 20480);
    expect(padded.length).toBe(20480);
    expect(new TextDecoder().decode(unpadFromSize(padded))).toBe(
      JSON.stringify({ hello: "world" }),
    );
  });

  it("fill bytes are random — two pads of the same input differ", () => {
    const input = new TextEncoder().encode("same input");
    const a = padToSize(input, 1024);
    const b = padToSize(input, 1024);
    expect(a.length).toBe(b.length);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
  });

  it("throws when the content cannot fit", () => {
    const input = new TextEncoder().encode("x".repeat(21000));
    expect(() => padToSize(input, 20480)).toThrow();
  });

  it("unpad of corrupted length prefix fails or returns garbage, never throws on random", () => {
    const padded = padToSize(new TextEncoder().encode("abc"), 256);
    padded[0] ^= 0xff; // corrupt length prefix
    // must not throw: the GCM tag is the real integrity check
    unpadFromSize(padded);
    expect(true).toBe(true);
  });
});

describe("sealed control frames are uniform", () => {
  it("a text frame and a typing frame have identical ciphertext length", async () => {
    const key = await randomAesKey();
    const clock = createSendClock();
    const text = await sealFrame({
      key,
      roomId: "R",
      kv: 1,
      senderId: "A",
      clock,
      body: { kind: "text", text: "a message of some length" },
      frameSize: CONTROL_FRAME_BYTES,
    });
    const typing = await sealFrame({
      key,
      roomId: "R",
      kv: 1,
      senderId: "A",
      clock,
      body: { kind: "typing", typing: true },
      frameSize: CONTROL_FRAME_BYTES,
    });
    const short = await sealFrame({
      key,
      roomId: "R",
      kv: 1,
      senderId: "A",
      clock,
      body: { kind: "text", text: "k" },
      frameSize: CONTROL_FRAME_BYTES,
    });
    const len = (f: typeof text) => fromB64(f.ct).length;
    expect(len(text)).toBe(CONTROL_FRAME_BYTES + 16); // + GCM tag
    expect(len(typing)).toBe(len(text));
    expect(len(short)).toBe(len(text));
  });

  it("tampered ciphertext fails to open", async () => {
    const key = await randomAesKey();
    const clock = createSendClock();
    const frame = await sealFrame({
      key,
      roomId: "R",
      kv: 1,
      senderId: "A",
      clock,
      body: { kind: "text", text: "intact" },
      frameSize: CONTROL_FRAME_BYTES,
    });
    frame.ct = frame.ct.slice(0, -8) + "AAAAAAAA";
    const { openFrame } = await import("@/lib/protocol");
    await expect(openFrame(key, frame)).resolves.toBeNull();
  });
});

describe("file transfers hide their size", () => {
  it("a 1 KB file and a 300 KB file produce the SAME frame count and frame sizes", async () => {
    const roomId = "FILROOM";
    const entryKey = await randomAesKey();
    const [alice] = await makeRoom(roomId, ["m-alice"], entryKey);

    const tiny = "A".repeat(1024);
    const big = "B".repeat(300 * 1024);
    const tinyB64 = Buffer.from(tiny, "utf8").toString("base64");
    const bigB64 = Buffer.from(big, "utf8").toString("base64");

    const tinyFrames = await alice.cipher.sealFile({
      name: "tiny.txt",
      mime: "text/plain",
      size: 1024,
      dataB64: tinyB64,
      sha: await sha256HexOfBytes(legacyFromB64(tinyB64)),
    });
    const bigFrames = await alice.cipher.sealFile({
      name: "big.txt",
      mime: "text/plain",
      size: 300 * 1024,
      dataB64: bigB64,
      sha: await sha256HexOfBytes(legacyFromB64(bigB64)),
    });

    // Same total number of frames: 1 meta + a FIXED number of chunks.
    expect(tinyFrames).toHaveLength(bigFrames.length);
    expect(tinyFrames).toHaveLength(1 + FILE_TOTAL_CHUNKS);

    // Every chunk frame has the same uniform ciphertext size.
    const chunkSizes = new Set(
      bigFrames.slice(1).map((f) => fromB64(f.ct).length),
    );
    expect(chunkSizes.size).toBe(1);
    expect([...chunkSizes][0]).toBe(FILE_FRAME_BYTES + 16);

    // And the meta frame is control-sized (indistinguishable from a text
    // message or a typing blip).
    expect(fromB64(tinyFrames[0].ct).length).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("the padded payload is always the fixed total length", () => {
    expect(FILE_PAYLOAD_B64).toBeGreaterThanOrEqual(
      Math.ceil((2 * 1024 * 1024) / 3) * 4,
    );
  });

  it("a receiver reassembles a padded file and recovers the exact original bytes", async () => {
    const roomId = "FILROOM2";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    const raw = randBytes(77 * 1024 + 13);
    const dataB64 = Buffer.from(raw).toString("base64");
    const frames = await alice.cipher.sealFile({
      name: "photo.bin",
      mime: "application/octet-stream",
      size: raw.length,
      dataB64,
      sha: await sha256HexOfBytes(raw),
    });

    let assembled: import("@/lib/room-protocol").OpenResult | undefined;
    for (const f of frames) {
      const r = await bob.cipher.open(f);
      if (r.type === "file") assembled = r;
    }
    expect(assembled).toBeDefined();
    if (assembled?.type === "file") {
      expect(assembled.file.size).toBe(raw.length);
      expect(assembled.file.sha).toBe(await sha256HexOfBytes(raw));
      const recovered = Buffer.from(assembled.file.dataB64, "base64");
      expect(Buffer.compare(recovered, Buffer.from(raw))).toBe(0);
    }
  });

  it("a file with a corrupted chunk is dropped (sha mismatch), never rendered wrong", async () => {
    const roomId = "FILROOM3";
    const entryKey = await randomAesKey();
    const [alice, bob] = await makeRoom(roomId, ["m-alice", "m-bob"], entryKey);

    const raw = new TextEncoder().encode("file file file");
    const dataB64 = Buffer.from(raw).toString("base64");
    const frames = await alice.cipher.sealFile({
      name: "a.txt",
      mime: "text/plain",
      size: raw.length,
      dataB64,
      sha: await sha256HexOfBytes(raw),
    });

    // Corrupt one chunk frame's ciphertext (flip inside ct).
    const victim = structuredClone(frames[2]);
    const bytes = fromB64(victim.ct);
    bytes[100] ^= 0x55;
    victim.ct = Buffer.from(bytes).toString("base64");

    let gotFile = false;
    for (const f of [frames[0], frames[1], victim, ...frames.slice(3)]) {
      const r = await bob.cipher.open(f);
      if (r.type === "file") gotFile = true;
    }
    expect(gotFile).toBe(false);
  });
});
