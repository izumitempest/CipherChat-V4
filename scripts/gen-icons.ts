// One-off brand asset generator — renders the Vanishing Ink to the
// PWA icons, the apple-touch icon and the OG card, using sharp
// (already in node_modules). No AI image generation anywhere: every
// pixel is the same crisp SVG geometry the app renders.
//
//   bun scripts/gen-icons.ts
//
// Outputs:
//   public/icons/icon-192.png            (paper rounded-square tile)
//   public/icons/icon-512.png            (same art, larger)
//   public/icons/icon-maskable-512.png   (full-bleed, mark inside the
//                                         80% maskable safe zone)
//   public/icons/apple-touch-icon.png    (180×180, opaque paper)
//   public/og.png                        (1200×630 — mark + wordmark)
//
// The brand hexes are hardcoded here on purpose: these files are
// standalone assets consumed outside the app's CSS variable system.

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");

/* ---- The Vanishing Ink geometry (mirrors src/components/cc/mark.tsx;
   keep the two in sync — this is the same 96×96 hand-tuned set) ---- */

const FOREST = "#3A4F41";
const EMBER = "#E8A87C";
const PAPER = "#F4F1EB";

/** The drop — a closed teardrop, the top edge ragged where it parts. */
const DROP =
  "M 46.3 29.4 C 45.1 35.2, 39.9 38.6, 36.9 43.6 C 33.7 48.9, 33.2 56.1, 36.4 61.7 " +
  "C 39.5 67.2, 46.4 70.7, 52.3 68.8 C 58.2 66.9, 62.6 61.4, 62.7 55.5 " +
  "C 62.8 49.9, 59.5 45.0, 55.9 41.0 C 53.3 38.3, 51.5 35.0, 51.0 31.4 " +
  "L 49.7 29.5 L 48.1 31.1 Z";

/** A four-pointed fleck — quadratics pulled toward the centre. */
function fleck(cx: number, cy: number, r: number, lean = 0): string {
  const k = r * 0.42;
  return (
    `M ${cx} ${cy - r} Q ${cx + k} ${cy - k}, ${cx + r} ${cy + lean} ` +
    `Q ${cx + k} ${cy + k}, ${cx} ${cy + r} ` +
    `Q ${cx - k} ${cy + k}, ${cx - r} ${cy - lean} ` +
    `Q ${cx - k} ${cy - k}, ${cx} ${cy - r} Z`
  );
}

const FLECK_1 = fleck(46.0, 21.5, 6.2);
const FLECK_2 = fleck(56.0, 11.5, 4.7);
const FLECK_3 = fleck(49.0, 3.2, 3.9);

/** The seated assembly (mirrors SEAT in mark.tsx). */
function markGroup(ink = FOREST, ember = EMBER): string {
  return (
    `<g transform="translate(44 61) rotate(21) scale(1.12) translate(-48 -48)">` +
    `<path d="${DROP}" fill="${ink}"/>` +
    `<path d="${FLECK_1}" fill="${ink}"/>` +
    `<path d="${FLECK_2}" fill="${ink}"/>` +
    `<path d="${FLECK_3}" fill="${ember}"/>` +
    `</g>`
  );
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });

  // Rounded paper tile, the drop's mass seated at ~(46%, 52%) so the
  // rising flecks balance it toward the upper right.
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${PAPER}"/>
  <g transform="translate(94.7 71.9) scale(3.35)">${markGroup()}</g>
</svg>`;

  await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile(path.join(ICONS_DIR, "icon-512.png"));
  await sharp(Buffer.from(iconSvg)).resize(192, 192).png().toFile(path.join(ICONS_DIR, "icon-192.png"));

  const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="${PAPER}"/>
  <g transform="translate(26 13.2) scale(1.18)">${markGroup()}</g>
</svg>`;
  await sharp(Buffer.from(appleSvg)).resize(180, 180).png().toFile(path.join(ICONS_DIR, "apple-touch-icon.png"));

  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${PAPER}"/>
  <g transform="translate(151 111) scale(2.5)">${markGroup()}</g>
</svg>`;
  await sharp(Buffer.from(maskSvg)).resize(512, 512).png().toFile(path.join(ICONS_DIR, "icon-maskable-512.png"));

  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="24" y="24" width="1152" height="582" rx="18" fill="none" stroke="#3A4F41" stroke-opacity="0.18" stroke-width="2"/>
  <g transform="translate(117.8 92.2) scale(4.1)">${markGroup()}</g>
  <text x="560" y="316" font-family="Georgia, 'Times New Roman', serif" font-size="64" font-weight="600" fill="#33342E" letter-spacing="-1">CipherChat</text>
  <text x="562" y="372" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-style="italic" fill="#6B6455">a conversation that leaves no trace</text>
</svg>`;
  await sharp(Buffer.from(ogSvg)).png().toFile(path.join(ROOT, "public", "og.png"));

  for (const f of [
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "../og.png",
  ]) {
    const s = await stat(path.join(ICONS_DIR, f));
    console.log(`  ${f.padEnd(24)} ${s.size} bytes`);
  }
  console.log("The Vanishing Ink seated on every tile.");
}

main();
