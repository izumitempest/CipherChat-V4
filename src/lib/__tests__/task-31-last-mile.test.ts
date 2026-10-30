// Task 31: THE LAST MILE.
//
// Three proofs the change record asked for by name:
//
//   31.5  The canonical covers the whole frame body, so the order the
//         body was built in cannot change it and no field can travel
//         unsigned. (This block used to prove that a pre-reply
//         eleven-field frame still verified under the current
//         canonical. The v3 canonical replaced that promise: v2 and
//         v3 do not talk to each other, because v2's signing string
//         could not tell two different bodies apart.)
//   31.4  The room-password generator draws six words from the CSPRNG
//         over the 256-word list (2^48 candidates), and from nothing
//         else (Math.random never touched).
//   31.3  The image metadata detector flags exactly the segments that
//         carry a photo's history (EXIF, XMP, comments) and passes
//         clean files through: the gate in front of the canvas
//         re-encode.

import { describe, it, expect, afterEach } from "vitest";
import { canonicalV3FromBody } from "@/lib/protocol";
import { generatePassphrase, PASS_WORDS } from "@/lib/identity";
import { imageHasMetadata, imageNeedsScan } from "@/lib/media";

/* ---------------- 31.5 canonical versioning ---------------- */

/* v3 signs the whole frame body. There is no slot list to keep in
 * step with the body shape: the body is serialised canonically and
 * hashed, so every field it carries is covered, including fields
 * added after this test was written. */

const BODY = {
  kind: "text",
  senderId: "m-sender",
  sessionTag: "tag-abc",
  counter: 41,
  ts: 1717000000123,
  kv: 3,
  sig: "",
  text: "the words themselves",
} as const;

describe("canonical versioning (31.5)", () => {
  it("the canonical does not depend on the order the body was built in", async () => {
    const a = await canonicalV3FromBody("ROOMX1", BODY);
    const b = await canonicalV3FromBody("ROOMX1", {
      sig: "",
      text: "the words themselves",
      kv: 3,
      ts: 1717000000123,
      counter: 41,
      sessionTag: "tag-abc",
      senderId: "m-sender",
      kind: "text",
    });
    expect(a).toBe(b);
  });

  it("a changed field changes the canonical", async () => {
    const base = await canonicalV3FromBody("ROOMX1", BODY);
    expect(await canonicalV3FromBody("ROOMX1", { ...BODY, text: "other words" })).not.toBe(base);
    expect(await canonicalV3FromBody("ROOMX1", { ...BODY, ttlSec: 60 })).not.toBe(base);
    expect(await canonicalV3FromBody("ROOMX1", { ...BODY, viewOnce: true })).not.toBe(base);
    expect(await canonicalV3FromBody("OTHERROOM", BODY)).not.toBe(base);
  });

  it("the signature field is not part of the canonical (it is computed over it)", async () => {
    const unsigned = await canonicalV3FromBody("ROOMX1", { ...BODY, sig: "" });
    const signed = await canonicalV3FromBody("ROOMX1", {
      ...BODY,
      sig: "not-a-real-signature",
    });
    expect(unsigned).toBe(signed);
  });
});

/* ---------------- 31.4 passphrase generator ---------------- */

describe("room-password generator (31.4)", () => {
  const realGetRandomValues = crypto.getRandomValues.bind(crypto);
  let mathRandomCalls = 0;
  const realMathRandom = Math.random;

  afterEach(() => {
    crypto.getRandomValues = realGetRandomValues;
    Math.random = realMathRandom;
  });

  it("defaults to six words from the 256-word list, all distinct, hyphen-joined", () => {
    expect(PASS_WORDS).toHaveLength(256);
    expect(new Set(PASS_WORDS).size).toBe(256); // the invariant unbiased sampling stands on
    const phrase = generatePassphrase();
    const words = phrase.split("-");
    expect(words).toHaveLength(6);
    for (const w of words) {
      expect(PASS_WORDS).toContain(w);
    }
    expect(new Set(words).size).toBe(6);
  });

  it("derives its words from the CSPRNG bytes - and never from Math.random", () => {
    mathRandomCalls = 0;
    Math.random = () => {
      mathRandomCalls++;
      return 0.5;
    };
    // Deterministic CSPRNG stub: bytes 0,1,2,…. The first six draws
    // pick PASS_WORDS[0..5] (all distinct indices, no refill needed).
    let next = 0;
    crypto.getRandomValues = ((buf: Uint8Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = next++ & 0xff;
      return buf;
    }) as typeof crypto.getRandomValues;

    const phrase = generatePassphrase();
    expect(phrase).toBe(
      [PASS_WORDS[0], PASS_WORDS[1], PASS_WORDS[2], PASS_WORDS[3], PASS_WORDS[4], PASS_WORDS[5]].join("-"),
    );
    expect(mathRandomCalls).toBe(0);
  });

  it("explicit word counts are honoured", () => {
    expect(generatePassphrase(3).split("-")).toHaveLength(3);
    expect(generatePassphrase(8).split("-")).toHaveLength(8);
  });

  it("distribution sanity: real CSPRNG samples stay in-list and distinct", () => {
    for (let i = 0; i < 50; i++) {
      const words = generatePassphrase(7).split("-");
      expect(words).toHaveLength(7);
      expect(new Set(words).size).toBe(7);
      for (const w of words) expect(PASS_WORDS).toContain(w);
    }
  });
});

/* ---------------- 31.3 image metadata detector ---------------- */

/** Minimal JPEG: SOI + optional segments + SOS marker. */
function jpeg(
  segments: Array<{ marker: number; payload: Uint8Array }>,
): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const s of segments) {
    parts.push(0xff, s.marker, (s.payload.length + 2) >> 8, (s.payload.length + 2) & 0xff);
    for (const b of s.payload) parts.push(b);
  }
  parts.push(0xff, 0xda); // SOS: scan starts, detector stops here
  return new Uint8Array(parts);
}

const EXIF_ID = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
const XMP_ID = new TextEncoder().encode("http://ns.adobe.com/xap/ <x:xmpmeta/>");
const JFIF = new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

/** Minimal PNG: signature + chunks. */
function png(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const enc = new TextEncoder();
  const parts: number[] = [...SIG];
  for (const c of chunks) {
    const type = enc.encode(c.type);
    parts.push(
      (c.data.length >>> 24) & 0xff, (c.data.length >>> 16) & 0xff,
      (c.data.length >>> 8) & 0xff, c.data.length & 0xff,
      ...type, ...c.data, 0, 0, 0, 0, // CRC (unchecked by the scanner)
    );
  }
  return new Uint8Array(parts);
}

/** Minimal WebP: RIFF header + chunks. */
function webp(chunks: Array<{ fourcc: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const body: number[] = [...enc.encode("WEBP")];
  for (const c of chunks) {
    const f = enc.encode(c.fourcc);
    body.push(
      ...f,
      c.data.length & 0xff, (c.data.length >> 8) & 0xff,
      (c.data.length >> 16) & 0xff, (c.data.length >> 24) & 0xff,
      ...c.data,
    );
    if (c.data.length & 1) body.push(0); // even padding
  }
  const size = body.length;
  return new Uint8Array([...enc.encode("RIFF"), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff, ...body]);
}

describe("image metadata detector (31.3)", () => {
  it("flags a JPEG carrying an EXIF APP1 segment", () => {
    const gps = new Uint8Array([...EXIF_ID, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]); // Exif + TIFF header
    expect(imageHasMetadata(jpeg([{ marker: 0xe1, payload: gps }]), "image/jpeg")).toBe(true);
  });

  it("flags a JPEG carrying an XMP APP1 packet", () => {
    expect(imageHasMetadata(jpeg([{ marker: 0xe1, payload: XMP_ID }]), "image/jpeg")).toBe(true);
  });

  it("flags a JPEG carrying a COM free-text comment", () => {
    expect(imageHasMetadata(jpeg([{ marker: 0xfe, payload: new TextEncoder().encode("made somewhere") }]), "image/jpeg")).toBe(true);
  });

  it("passes a clean JPEG (JFIF only) through", () => {
    expect(imageHasMetadata(jpeg([{ marker: 0xe0, payload: JFIF }]), "image/jpeg")).toBe(false);
  });

  it("flags a PNG with an eXIf or text chunk, passes a clean PNG", () => {
    const clean = png([
      { type: "IHDR", data: new Uint8Array(13) },
      { type: "IDAT", data: new Uint8Array(16) },
      { type: "IEND", data: new Uint8Array(0) },
    ]);
    expect(imageHasMetadata(clean, "image/png")).toBe(false);
    const withExif = png([
      { type: "IHDR", data: new Uint8Array(13) },
      { type: "eXIf", data: new Uint8Array(10) },
      { type: "IEND", data: new Uint8Array(0) },
    ]);
    expect(imageHasMetadata(withExif, "image/png")).toBe(true);
    const withText = png([
      { type: "IHDR", data: new Uint8Array(13) },
      { type: "tEXt", data: new TextEncoder().encode("Comment\x00hello") },
      { type: "IEND", data: new Uint8Array(0) },
    ]);
    expect(imageHasMetadata(withText, "image/png")).toBe(true);
  });

  it("flags a WebP with an EXIF chunk, passes a clean WebP", () => {
    const clean = webp([{ fourcc: "VP8X", data: new Uint8Array(10) }, { fourcc: "VP8 ", data: new Uint8Array(20) }]);
    expect(imageHasMetadata(clean, "image/webp")).toBe(false);
    const withExif = webp([
      { fourcc: "VP8X", data: new Uint8Array(10) },
      { fourcc: "EXIF", data: new Uint8Array(12) },
      { fourcc: "VP8 ", data: new Uint8Array(20) },
    ]);
    expect(imageHasMetadata(withExif, "image/webp")).toBe(true);
  });

  it("treats unparseable image bytes as suspect - fail toward the strip", () => {
    expect(imageHasMetadata(new Uint8Array([1, 2, 3]), "image/jpeg")).toBe(true);
    expect(imageHasMetadata(new Uint8Array([0x89, 0x50]), "image/png")).toBe(true);
  });

  it("the scan scope is the canvas-rebuildable raster formats", () => {
    expect(imageNeedsScan("image/jpeg")).toBe(true);
    expect(imageNeedsScan("image/jpg")).toBe(true);
    expect(imageNeedsScan("image/png")).toBe(true);
    expect(imageNeedsScan("image/webp")).toBe(true);
    // GIF keeps its animation, SVG keeps its vectors, by policy.
    expect(imageNeedsScan("image/gif")).toBe(false);
    expect(imageNeedsScan("image/svg+xml")).toBe(false);
    expect(imageNeedsScan("video/mp4")).toBe(false);
  });
});
