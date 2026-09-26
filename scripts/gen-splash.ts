// iOS splash-screen generator: composes the Vanishing Ink and the
// serif wordmark onto paper for every current iPhone/iPad launch
// resolution, using sharp (the same pipeline that renders the icons
// and og.png: no AI image generation, no re-drawn paths).
//
//   bun scripts/gen-splash.ts
//
// Outputs (public/splash/, named by REAL pixel size = css × dpr):
//   splash-640x1136.png    320×568 @2   iPhone SE (1st gen)
//   splash-750x1334.png    375×667 @2   iPhone SE (2nd/3rd), 6/7/8
//   splash-1125x2436.png   375×812 @3   X / XS / 11 Pro / 12 mini
//   splash-1170x2532.png   390×844 @3   12 / 13 / 14
//   splash-1179x2556.png   393×852 @3   14 Pro / 15
//   splash-1242x2208.png   414×736 @3   6/7/8 Plus
//   splash-828x1792.png    414×896 @2   XR / 11
//   splash-1242x2688.png   414×896 @3   XS Max / 11 Pro Max
//   splash-1284x2778.png   428×926 @3   12/13/14 Plus & Pro Max
//   splash-1290x2796.png   430×932 @3   14/15/16 Pro Max
//   splash-1320x2868.png   440×956 @3   16 Pro
//   splash-1536x2048.png   768×1024 @2  iPad (Air / mini / 9.7–10.2")
//   splash-2048x2732.png   1024×1366 @2 iPad Pro 12.9"
//
// The composition mirrors og.png's recipe (see gen-icons.ts): flat
// paper, the mark, and the wordmark set in Georgia with the same
// charcoal ink, but arranged as a vertical lockup: the mark's visual
// centre seated at 42% of the screen height, "CipherChat" beneath.
//
// The mark geometry is NOT re-declared here: the inner group is read
// verbatim from public/logo.svg (the single source of truth) and
// seated inside a nested <svg> box. Its var(--forest, …) fills carry
// hex fallbacks, which librsvg resolves. Verified: the drop renders
// #3A4F41, not black. The box is placed by MEASUREMENT, not by eye:
// the script renders the mark once, scans the alpha channel for the
// true ink bounds, and centers those bounds on the target point.

import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPLASH_DIR = path.join(ROOT, "public", "splash");
const LOGO = path.join(ROOT, "public", "logo.svg");

/* Brand hexes: standalone assets live outside the CSS variable
 * system (same policy as gen-icons.ts). */
const PAPER = "#F4F1EB";
const WORD_INK = "#33342E"; // the wordmark's charcoal, as in og.png

/* Layout, all in CSS pixels so every device gets the same proportions:
 *   mark visual width  = 26% of the CSS width
 *   wordmark font size = 9.5% of the CSS width (≈ 36.5% of the mark)
 *   mark visual centre = 50% across, 42% down
 *   wordmark baseline  = mark's true bottom + 0.85 × font size of air */
const MARK_W_FRAC = 0.26;
const WORD_F_FRAC = 0.095;
const MARK_AT_Y = 0.42;
const BASELINE_AIR = 0.85;

/** [cssW, cssH, dpr, human label]: the iPhone/iPad matrix the
 *  apple-splash.tsx link component mirrors. Keep the two in sync. */
const DEVICES: ReadonlyArray<readonly [number, number, number, string]> = [
  [320, 568, 2, "iPhone SE (1st gen)"],
  [375, 667, 2, "iPhone SE (2nd/3rd), 6/7/8"],
  [375, 812, 3, "iPhone X/XS/11 Pro/12 mini"],
  [390, 844, 3, "iPhone 12/13/14"],
  [393, 852, 3, "iPhone 14 Pro/15"],
  [414, 736, 3, "iPhone 6/7/8 Plus"],
  [414, 896, 2, "iPhone XR/11"],
  [414, 896, 3, "iPhone XS Max/11 Pro Max"],
  [428, 926, 3, "iPhone 12/13/14 Plus, Pro Max"],
  [430, 932, 3, "iPhone 14/15/16 Pro Max"],
  [440, 956, 3, "iPhone 16 Pro"],
  [768, 1024, 2, "iPad Air/mini/9.7-10.2"],
  [1024, 1366, 2, "iPad Pro 12.9"],
];

/** Read public/logo.svg and return its inner group: the mark as
 *  drawn, comments and all, for nesting inside the composition. */
async function loadMarkInner(): Promise<string> {
  const src = await readFile(LOGO, "utf8");
  const m = src.match(/<svg[^>]*>([\s\S]*)<\/svg\s*>/);
  if (!m) throw new Error("public/logo.svg: could not isolate the mark group");
  return m[1];
}

/** Render the mark alone at 10× and scan the alpha channel for the
 *  true ink bounds in logo.svg's 96×96 viewBox units. The mark is
 *  taller than it is wide (the flecks climb), so the measured box,
 *  not the square viewBox, is what gets centered. */
async function measureMark(inner: string): Promise<{
  minX: number; minY: number; maxX: number; maxY: number;
  cx: number; cy: number; w: number; h: number;
}> {
  const SCALE = 10;
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="${96 * SCALE}" height="${96 * SCALE}" viewBox="0 0 96 96">${inner}</svg>`;
  const { data, info } = await sharp(Buffer.from(probe))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const { width, height, channels } = info;
  const a = channels - 1; // alpha is always last in raw output
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + a] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) throw new Error("mark measurement: no ink pixels found");

  const box = {
    minX: minX / SCALE, minY: minY / SCALE,
    maxX: maxX / SCALE, maxY: maxY / SCALE,
    cx: 0, cy: 0, w: 0, h: 0,
  };
  box.w = box.maxX - box.minX;
  box.h = box.maxY - box.minY;
  box.cx = (box.minX + box.maxX) / 2;
  box.cy = (box.minY + box.maxY) / 2;
  return box;
}

async function main() {
  await mkdir(SPLASH_DIR, { recursive: true });
  const inner = await loadMarkInner();
  const box = await measureMark(inner);
  console.log(
    `mark measured in viewBox units: x ${box.minX.toFixed(1)}–${box.maxX.toFixed(1)}, ` +
    `y ${box.minY.toFixed(1)}–${box.maxY.toFixed(1)} (w ${box.w.toFixed(1)}, h ${box.h.toFixed(1)})`,
  );

  let total = 0;
  const rows: string[] = [];

  for (const [cssW, cssH, dpr, label] of DEVICES) {
    // Real pixel canvas, composed at final size, like og.png.
    const W = cssW * dpr;
    const H = cssH * dpr;

    // Seat the measured ink box so its centre lands at (50%, 42%).
    const markW = MARK_W_FRAC * cssW * dpr;   // target visual width, px
    const s = markW / box.w;                  // px per viewBox unit
    const markBox = 96 * s;                   // nested <svg> side, px
    const markX = W / 2 - box.cx * s;
    const markY = MARK_AT_Y * H - box.cy * s;

    // The wordmark beneath, in the og.png ink.
    const F = WORD_F_FRAC * cssW * dpr;       // font size, px
    const baseline = markY + box.maxY * s + BASELINE_AIR * F;
    const letterSpacing = -0.016 * F;         // og ratio: -1 at 64px

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
      `<svg x="${markX.toFixed(2)}" y="${markY.toFixed(2)}" width="${markBox.toFixed(2)}" height="${markBox.toFixed(2)}" viewBox="0 0 96 96">${inner}</svg>` +
      `<text x="${W / 2}" y="${baseline.toFixed(2)}" text-anchor="middle" ` +
      `font-family="Georgia, 'Times New Roman', serif" font-size="${F.toFixed(2)}" ` +
      `font-weight="600" fill="${WORD_INK}" letter-spacing="${letterSpacing.toFixed(2)}">CipherChat</text>` +
      `</svg>`;

    const file = path.join(SPLASH_DIR, `splash-${W}x${H}.png`);
    const info = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(file);

    total += info.size;
    rows.push(
      `  splash-${W}x${H}.png`.padEnd(26) +
      `${String(info.size).padStart(7)} bytes   ${cssW}×${cssH} @${dpr}  ${label}`,
    );
    if (info.width !== W || info.height !== H) {
      throw new Error(`splash-${W}x${H}.png: expected ${W}×${H}, got ${info.width}×${info.height}`);
    }
  }

  console.log(rows.join("\n"));
  console.log(`  ${"total".padEnd(25)} ${String(total).padStart(7)} bytes (${(total / 1024).toFixed(0)} KB)`);
  if (total > 900 * 1024) {
    console.warn("  WARNING: total exceeds the 900 KB budget. Tighten palette quality.");
  }
  console.log("Wrote splash screens for all device sizes.");
}

main();
