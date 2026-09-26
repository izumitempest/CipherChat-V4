// Builds a GPS-tagged JPEG for the E2E golden path, the same fixture
// idea as Task 31's /home/z/qa31/make-gps-jpeg.mjs, inlined so the test
// is self-contained (no ffmpeg at test time): the committed 64×64
// base-tiny.jpg gets a real EXIF APP1 segment (TIFF IFD0 → GPS IFD,
// 6°30'30.5"N 3°12'15.2"W) inserted right after SOI, exactly where a
// camera puts it. If the composer's EXIF strip is working, what arrives
// on the other side is a re-encoded JPEG with no APP1 at all.
import { readFileSync } from "fs";
import { join } from "path";

export function buildGpsJpeg(): Buffer {
  const base = readFileSync(join(process.cwd(), "tests/e2e/fixtures/base-tiny.jpg"));
  if (base[0] !== 0xff || base[1] !== 0xd8) throw new Error("base-tiny.jpg is not a JPEG");

  const tiff: number[] = [];
  tiff.push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00); // II, 42, IFD0@8
  tiff.push(
    0x01, 0x00, // IFD0: 1 entry
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, // GPSInfo -> 26
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  );
  tiff.push(
    0x04, 0x00, // GPS IFD @26: 4 entries
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, // LatRef "N"
    0x02, 0x00, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, // Lat @80
    0x03, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x57, 0x00, 0x00, 0x00, // LonRef "W"
    0x04, 0x00, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00, // Lon @104
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  );
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  tiff.push(...u32(6), ...u32(1), ...u32(30), ...u32(1), ...u32(3050), ...u32(100)); // 6°30'30.5"
  tiff.push(...u32(3), ...u32(1), ...u32(12), ...u32(1), ...u32(1520), ...u32(100)); // 3°12'15.2"

  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];

  const out = new Uint8Array(2 + app1.length + base.length - 2);
  out.set([0xff, 0xd8], 0);
  out.set(app1, 2);
  out.set(base.subarray(2), 2 + app1.length);
  return Buffer.from(out);
}

/** The clean, metadata-free base image (view-once fixture, passes
 *  through the EXIF scan untouched, no re-encode). */
export function readCleanJpeg(): Buffer {
  return readFileSync(join(process.cwd(), "tests/e2e/fixtures/base-tiny.jpg"));
}
