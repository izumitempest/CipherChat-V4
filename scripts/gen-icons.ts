// One-off brand asset generator — renders the Split Seal to the PWA
// icons, the apple-touch icon and the OG card, using sharp (already
// in node_modules). No AI image generation anywhere: every pixel is
// the same crisp SVG geometry the app renders.
//
//   bun scripts/gen-icons.ts
//
// Outputs:
//   public/icons/icon-192.png            (paper rounded-square tile)
//   public/icons/icon-512.png            (same art, larger)
//   public/icons/icon-maskable-512.png   (full-bleed, mark inside the
//                                         80% maskable safe zone)
//   public/icons/apple-touch-icon.png    (180×180, opaque paper)
//   public/og.png                        (1200×630 — seal + wordmark)
//
// The two brand hexes are hardcoded here on purpose: these files are
// standalone assets consumed outside the app's CSS variable system.

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");

/* ---- The Split Seal geometry (mirrors src/components/cc/mark.tsx;
   keep the two in sync — this is the same 96×96 hand-tuned set) ---- */

const RING_A =
  "M 61.83 16.94 C 45.77 9.79, 26.25 16.63, 18.07 33.4 C 9.81 50.33, 16.67 69.85, 32.04 78.02";
const RING_B =
  "M 34.17 79.06 C 50.97 86.54, 70.6 80.27, 78.99 64.48 C 87.21 49.02, 82.07 29.2, 66.02 19.17";
const DISC_A =
  "M 53.29 36.12 C 46.89 33.28, 39.39 36.01, 36.32 42.3 C 33.25 48.6, 35.71 56.19, 41.9 59.48 Z";
const DISC_B =
  "M 42.71 59.88 C 48.95 62.65, 56.27 60.13, 59.48 54.1 C 62.68 48.07, 60.68 40.59, 54.89 36.98 Z";
const GLINT = "M 57.15 30.78 L 54.36 33.26 L 53.87 36.96 L 56.66 34.48 Z";

const INK = "#3A4F41"; // forest
const EMBER = "#E8A87C"; // the heat in the fracture
const PAPER = "#F4F1EB"; // the tile
const CHARCOAL = "#2C2A28"; // wordmark

/** The seated (intact) seal as a single group, its 96×96 box scaled
 *  to `box` px and translated so its centre sits at (cx, cy). */
function sealGroup(cx: number, cy: number, box: number): string {
  const x = cx - box / 2;
  const y = cy - box / 2;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(box / 96).toFixed(4)})">
  <g transform="translate(-0.4 -0.21) rotate(-1.2 48 48)">
    <path d="${RING_A}" fill="none" stroke="${INK}" stroke-width="7.5"/>
    <path d="${DISC_A}" fill="${INK}"/>
  </g>
  <g transform="translate(0.44 0.23) rotate(1.4 48 48)">
    <path d="${RING_B}" fill="none" stroke="${INK}" stroke-width="7.5"/>
    <path d="${DISC_B}" fill="${INK}"/>
  </g>
  <path d="${GLINT}" fill="${EMBER}"/>
</g>`;
}

/** Paper rounded-square tile with the seal centred — the "any" icons.
 *  markBox is the fraction of the edge the 96×96 box occupies (the
 *  seal's visual diameter is ~79% of its box). */
function tileSvg(edge: number, markBox: number): string {
  const rx = Math.round(edge * 0.1875); // same 96/512 corner as icon.svg
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">
  <rect width="${edge}" height="${edge}" rx="${rx}" fill="${PAPER}"/>
  ${sealGroup(edge / 2, edge / 2, edge * markBox)}
</svg>`;
}

/** Full-bleed paper square (the launcher crops its own shape) with
 *  the mark well inside the 80% maskable safe zone. */
function maskableSvg(edge: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">
  <rect width="${edge}" height="${edge}" fill="${PAPER}"/>
  ${sealGroup(edge / 2, edge / 2, edge * 0.72)}
</svg>`;
}

/** The OG card: paper, the seal large and centred-left, the wordmark
 *  in a system serif (Georgia where it exists, Liberation Serif — a
 *  Times-metric transitional — everywhere else; next/font is not
 *  available to sharp, and a raster Lora is not worth the weight). */
function ogSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  ${sealGroup(280, 315, 340)}
  <text x="520" y="348" font-family="Georgia, 'Liberation Serif', 'Times New Roman', serif"
        font-size="96" font-weight="600" letter-spacing="-1" fill="${CHARCOAL}">CipherChat</text>
  <text x="524" y="400" font-family="Georgia, 'Liberation Serif', 'Times New Roman', serif"
        font-size="30" font-style="italic" letter-spacing="0.5" fill="${CHARCOAL}" opacity="0.62">A conversation that leaves no trace.</text>
</svg>`;
}

/* ---- render + verify ---- */

async function render(file: string, svg: string, w: number, h: number): Promise<void> {
  await sharp(Buffer.from(svg)).resize(w, h).png().toFile(file);
  const meta = await sharp(file).metadata();
  const size = (await stat(file)).size;
  if (meta.width !== w || meta.height !== h || !size) {
    throw new Error(`${file}: expected ${w}×${h}, got ${meta.width}×${meta.height}`);
  }
  const kb = (size / 1024).toFixed(1);
  console.log(`✓ ${path.relative(ROOT, file)}  ${meta.width}×${meta.height}  ${kb} KB`);
}

async function main(): Promise<void> {
  await mkdir(ICONS_DIR, { recursive: true });

  // "any" icons — mark box ≈ 80% of the tile edge (visual ≈ 63%).
  await render(path.join(ICONS_DIR, "icon-192.png"), tileSvg(512, 0.806), 192, 192);
  await render(path.join(ICONS_DIR, "icon-512.png"), tileSvg(512, 0.806), 512, 512);
  // maskable — full-bleed, mark box 72% (visual ≈ 57%) < 80% safe zone.
  await render(path.join(ICONS_DIR, "icon-maskable-512.png"), maskableSvg(512), 512, 512);
  // apple touch — opaque paper, iOS applies its own corner mask.
  await render(path.join(ICONS_DIR, "apple-touch-icon.png"), tileSvg(512, 0.806), 180, 180);
  // OG card.
  await render(path.join(ROOT, "public", "og.png"), ogSvg(), 1200, 630);

  console.log("\nAll brand assets rendered from the Split Seal geometry.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
