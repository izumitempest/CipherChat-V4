// Images can carry metadata about their own history.
//
// A photo fresh from a camera can hold GPS coordinates, a device
// serial, timestamps and shooting notes in EXIF/XMP metadata, and
// CipherChat encrypts whatever bytes it is given. For a product whose
// promise is "a conversation that leaves no trace", sending a
// photo that carries its own location data inside the ciphertext
// is a privacy failure the recipient's viewer cannot undo.
//
// The policy: before an image is attached, its bytes are scanned for
// metadata segments. Clean files pass through untouched: no
// re-encode, no quality loss, no cost. Files that carry metadata are
// re-encoded through a canvas (pixels only; the re-encode cannot
// inspect the file's metadata, so none survives) and it is the
// RE-ENCODED bytes that get encrypted. If the re-encode fails on a
// file that carried metadata, the file is not attached at all: the
// actual failure is a notice, never a
// silent send of location data.
//
// Formats out of scope, and why: SVG carries no EXIF and
// is never rasterised here (its scripts are neutralised by the img
// context in the viewer); GIF's metadata surface is limited to text
// comments, and a re-encode would kill animation for a risk that is
// not location-related. Both pass through.

/** Does this image's byte stream carry privacy-relevant metadata?
 * Pure, byte-level, and conservative: anything that could hold a
 * location, a device, or a free-text note flags the file. JPEG scans
 * its segment table (APP1 Exif, APP1 XMP, COM); PNG scans its chunk
 * table (eXIf, tEXt/iTXt/zTXt); WebP scans RIFF chunk fourccs
 * (EXIF/XMP). Anything unreadable flags clean only when its structure
 * says so. Unknown containers of an image/* type flag true. */
export function imageHasMetadata(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg" || mime === "image/jpg") return jpegHasMetadata(bytes);
  if (mime === "image/png") return pngHasMetadata(bytes);
  if (mime === "image/webp") return webpHasMetadata(bytes);
  // Other image types (gif, svg, bmp, heic, …) pass through by the
  // scope decision above; the caller decides what to do with them.
  return false;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    s += String.fromCharCode(bytes[offset + i]);
  }
  return s;
}

/** JPEG: walk the marker segments. APP0/JFIF and the image data are
 * fine; APP1 (Exif or XMP) and COM (free-text comments) are not. */
function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return true; // not a JPEG we can parse; treat as suspect
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return true; // no SOI; suspect
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return true; // desynchronised; suspect
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte before the real marker; legal padding
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers carry no payload
      continue;
    }
    if (marker === 0xda) return false; // SOS: image data starts, scan over
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return true; // malformed length; suspect
    if (marker === 0xe1) {
      // APP1: "Exif\0\0" (TIFF/EXIF) or an XMP packet. Both flag.
      const id = asciiAt(bytes, i + 4, 29);
      if (id.startsWith("Exif") || id.startsWith("http://ns.adobe.com/xap/")) return true;
    }
    if (marker === 0xfe) return true; // COM: a free-text comment
    i += 2 + len;
  }
  return false; // reached the end without suspect segments
}

/** PNG: walk the chunk table after the 8-byte signature. */
function pngHasMetadata(bytes: Uint8Array): boolean {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || SIG.some((b, k) => bytes[k] !== b)) return true; // suspect
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = asciiAt(bytes, i + 4, 4);
    if (type === "IEND") return false;
    if (len < 0 || i + 12 + len > bytes.length) return true; // malformed; suspect
    if (type === "eXIf" || type === "tEXt" || type === "iTXt" || type === "zTXt") return true;
    if (type === "tIME") return true; // a timestamp is metadata too
    i += 12 + len; // data + 4-byte CRC
  }
  return false;
}

/** WebP: RIFF container, chunk fourccs after the 12-byte header. */
function webpHasMetadata(bytes: Uint8Array): boolean {
  const riff = asciiAt(bytes, 0, 4);
  const webp = asciiAt(bytes, 8, 4);
  if (riff !== "RIFF" || webp !== "WEBP") return true; // suspect
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = asciiAt(bytes, i, 4);
    const len = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    if (fourcc === "EXIF" || fourcc === "XMP ") return true;
    if (len < 0 || i + 8 + len > bytes.length) return true; // malformed; suspect
    i += 8 + len + (len & 1); // chunks are padded to even sizes
  }
  return false;
}

/** Should this (mime) be examined at all? The scan-and-re-encode
 * pipeline applies to the raster formats the canvas can rebuild
 * faithfully; SVG and GIF pass through untouched by policy. */
export function imageNeedsScan(mime: string): boolean {
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp"
  );
}

/** Re-encode an image through a canvas: decode → draw → encode. The
 * result carries the pixels and nothing else: no EXIF, no XMP, no
 * comments; the file's history stays on the sender's machine.
 * Returns null when the browser cannot decode or re-encode it (the
 * caller's actual failure path). JPEG/WebP re-encode at quality
 * 0.92; PNG re-encodes losslessly. Browser-only by nature. */
export async function reencodeImage(file: File): Promise<Blob | null> {
  try {
    let width = 0;
    let height = 0;
    let source: CanvasImageSource;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } catch {
      // Fallback for browsers/SVG-ish edge cases: <img> + object URL.
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("decode failed"));
          el.src = url;
        });
        width = img.naturalWidth;
        height = img.naturalHeight;
        source = img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    bitmap?.close();
    const type = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, 0.92);
    });
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}
