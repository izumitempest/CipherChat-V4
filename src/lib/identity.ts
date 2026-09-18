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

// For room passwords — words meant to be read aloud and typed on a
// phone. EXACTLY 256 of them, so one random byte picks one word with
// zero bias, and six words carry 48 bits of entropy. The list is the
// whole defense: the room's verifier bundle is a public offline
// oracle (see kdf.ts), so the password itself must be big enough that
// grinding argon2id over every possible passphrase outlives any
// attacker's budget. The old 24-word list held 18 bits — under 7
// hours of single-CPU guessing — which is why it is gone; the 5-word
// interim (40 bits) survived a laptop but not a ~100-GPU cluster
// (months, not years) — 48 bits multiplies that grind by 256×.
export const PASS_WORDS = [
  "acorn", "almanac", "amber", "anchor", "apple", "apricot", "arrow",
  "aspen", "badger", "basil", "basket", "birch",
  "bison", "blanket", "blossom", "bonfire", "bookmark",
  "bracken", "bramble", "brass", "briar", "brook", "brush", "buckle",
  "burrow", "cabin", "candle", "canvas", "canyon", "cardinal", "cedar",
  "chalk", "chestnut", "chimney", "cinnamon", "cliff", "clover",
  "cobalt", "compass", "copper", "coral", "cotton", "crayon", "creek",
  "crown", "dahlia", "daisy", "dawn", "deer", "delta",
  "denim", "dew", "dill", "dolphin", "drift", "driftwood",
  "dune", "dusk", "eagle", "elder", "elm", "ember", "emerald",
  "falcon", "feather", "felt", "fern", "finch", "fjord",
  "flannel", "flint", "flora", "forest", "fossil", "foxglove",
  "garnet", "geode", "geyser", "ginger", "glacier", "glade", "glass",
  "glove", "granite", "gravel", "grove", "gull", "hammock",
  "harbor", "hatch", "hawthorn", "hazel", "heather", "hedge", "heron",
  "hickory", "hollow", "honey", "indigo", "inkwell",
  "iris", "island", "ivy", "jasmine", "jetty", "jewel", "juniper",
  "jute", "kettle", "knot", "lace",
  "lagoon", "lantern", "larch", "lavender", "ledger", "lemon",
  "lichen", "lilac", "linen", "locket", "lodge", "loon", "lotus",
  "lumber", "lupine", "magnet", "magpie", "mahogany", "maple",
  "marigold", "marlin", "marten", "meadow", "mitten",
  "monsoon", "moonrise", "moss", "moth", "mountain", "mulberry",
  "nebula", "nest", "nettle", "notebook",
  "nutmeg", "ocean", "olive", "onyx", "opal", "orchard", "osprey",
  "otter", "owl", "paddle", "pansy", "parsley", "pastel",
  "patch", "patio", "pebble", "peony", "pepper", "pigeon", "pillow",
  "pine", "plum", "pollen", "pond", "poplar", "poppy",
  "porch", "prairie", "primrose", "puffin", "quartz", "quill", "quince",
  "rabbit", "raccoon", "radish", "rain", "ravine", "reed",
  "reef", "ribbon", "ripple", "river", "rook", "rosemary",
  "rubble", "saddle", "saffron", "sage", "salmon", "sandal", "sapphire",
  "satchel", "scarlet", "seaweed", "shawl", "shepherd", "shore",
  "shovel", "shrub", "silk", "silver", "sketch", "slate", "smock",
  "snowfall", "sorrel", "sparrow", "spindle", "spruce", "starling",
  "stone", "sundial", "swan", "tapestry", "teak",
  "thicket", "thimble", "thistle", "thyme", "tide", "tiger", "timber",
  "tinder", "topaz", "trail", "trellis", "trout", "truffle", "tulip",
  "tundra", "tweed", "umber", "valley", "vanilla", "velvet",
  "verbena", "vellum", "vine", "violet",
  "walnut", "waxwing", "wicker", "willow", "windmill", "winter",
  "wolf", "wren", "yarrow", "zebra", "zinnia",
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

/** A room password, drawn from the CSPRNG — never Math.random, whose
 * xorshift stream is predictable and shared with unrelated app code.
 * Each byte selects one of the 256 words exactly (no modulo bias at
 * this list size; the rejection guard below keeps the function honest
 * if the list ever changes), duplicates are skipped so the words stay
 * distinct, and the 6-word default holds 2^48 candidates — grinding
 * the public verifier through argon2id over all of them is a
 * multi-century single-machine project, and a multi-year one for a
 * large cluster, instead of an afternoon. */
export function generatePassphrase(words = 6): string {
  const n = Math.min(words, PASS_WORDS.length);
  const limit = Math.floor(256 / PASS_WORDS.length) * PASS_WORDS.length;
  const picks: string[] = [];
  const used = new Set<number>();
  const buf = crypto.getRandomValues(new Uint8Array(32));
  let k = 0;
  while (picks.length < n) {
    if (k === buf.length) {
      crypto.getRandomValues(buf); // refill in place
      k = 0;
    }
    const b = buf[k++];
    if (b >= limit) continue; // unbiased: reject the tail
    const i = b % PASS_WORDS.length;
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
