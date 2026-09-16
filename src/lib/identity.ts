// Identity without names. A member's alias and ink are derived,
// deterministically, from the fingerprint of their signing key —
// the same key everyone verifies in the fingerprint panel.

const ADJECTIVES = [
  "Ashen", "Quiet", "Amber", "Cedar", "Copper", "Dusty", "Fallow", "Faint",
  "Gentle", "Hollow", "Ivory", "Late", "Mellow", "Northern", "Pale", "River",
  "Sage", "Silent", "Soft", "Still", "Tawny", "Umber", "Velvet", "Winter",
];

const ANIMALS = [
  "Fox", "Heron", "Wren", "Otter", "Lynx", "Crane", "Badger", "Elk",
  "Moth", "Owl", "Hare", "Finch", "Kestrel", "Marten", "Plover", "Sable",
  "Teal", "Vole", "Cormorant", "Dunlin", "Ermine", "Ferret", "Goshawk", "Ibis",
];

// For room passwords — words meant to be read aloud and typed on a phone.
const PASS_WORDS = [
  "almanac", "bramble", "clover", "driftwood", "fern", "grove", "harbor",
  "inkwell", "juniper", "kettle", "lantern", "lilac", "meadow", "nutmeg",
  "opal", "orchard", "pebble", "quill", "ripple", "saffron", "thistle",
  "vellum", "willow", "yarrow",
];

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Fingerprint of a signing public key (JWK): first 8 hex of sha256(x|y). */
export async function keyFingerprint(pubJwk: JsonWebKey): Promise<string> {
  const hex = await sha256Hex(`${pubJwk.x}|${pubJwk.y}`);
  return hex.slice(0, 8).toUpperCase();
}

/** Grouped for reading aloud: 3F2A · 91BC */
export function groupFingerprint(fp: string): string {
  return `${fp.slice(0, 4)} · ${fp.slice(4, 8)}`;
}

export function aliasFromFingerprint(hex: string): string {
  const a = parseInt(hex.slice(8, 12), 16) % ADJECTIVES.length;
  const b = parseInt(hex.slice(12, 16), 16) % ANIMALS.length;
  return `${ADJECTIVES[a]} ${ANIMALS[b]}`;
}

export function inkFromFingerprint(hex: string): number {
  return parseInt(hex.slice(16, 20), 16) % 8;
}

export function generatePassphrase(words = 4): string {
  const picks: string[] = [];
  const used = new Set<number>();
  while (picks.length < words) {
    const i = Math.floor(Math.random() * PASS_WORDS.length);
    if (used.has(i)) continue;
    used.add(i);
    picks.push(PASS_WORDS[i]);
  }
  return picks.join("-");
}

/** "Code" is whatever a human pastes — a link, or the bare room code. */
export function parseRoomCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Bare code
  if (/^[0-9A-Za-z]{6,16}$/.test(trimmed)) return trimmed.toUpperCase();
  // A link — grab ?join= or the last path segment
  try {
    const url = new URL(trimmed);
    const join = url.searchParams.get("join");
    if (join && /^[0-9A-Za-z]{6,16}$/.test(join)) return join.toUpperCase();
    const hash = url.hash.replace(/^#\/?/, "");
    if (/^join\/[0-9A-Za-z]{6,16}$/i.test(hash)) {
      return hash.split("/")[1].toUpperCase();
    }
    const seg = url.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/^[0-9A-Za-z]{6,16}$/.test(seg)) return seg.toUpperCase();
  } catch {
    /* not a URL */
  }
  return null;
}
