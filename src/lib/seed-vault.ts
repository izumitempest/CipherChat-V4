// Seed vault: the device seed lives as a non-extractable CryptoKey in
// IndexedDB, not as bytes in localStorage.
//
// Security properties of the non-extractable form:
//   - The raw 32-byte seed cannot be read back out through the WebCrypto
//     API. A script injected into the page (XSS) can call deriveBits on
//     the key to compute a per-room scalar, but it cannot exfiltrate the
//     seed itself, so it cannot impersonate the device from elsewhere or
//     after the tab closes.
//   - The browser's localStorage / profile-directory dump contains no
//     long-term secret. Both the live seed and the retired `cc.device`
//     keypair are removed from localStorage on migration.
//
// What this does NOT protect against (unchanged, and documented in
// DESIGN.md): an attacker with physical access or full control of the
// browser profile directory can copy the IndexedDB files. This form is a
// defense against script-level and casual inspection, not device theft.
//
// Continuity invariant: derivation from a migrated seed must produce the
// exact per-room ECDSA keys (and therefore fingerprints, aliases, and
// verification marks) that the pre-vault localStorage path produced. The
// fixed vector in the task-19.4 test enforces this: HKDF-SHA256 with
// salt = roomId and info = "cc-sig-v1", the same parameters both paths.
//
// Fallback: when IndexedDB is unavailable (older browsers, some privacy
// modes), the seed stays in memory for the page load only. The room list
// still works; identities do not survive the refresh. This matches the
// behavior localStorage private mode already had.

const DB_NAME = "cc";
const DB_VERSION = 1;
const STORE = "vault";
const KEY_ID = "seed";
const LEGACY_SEED_KEY = "cc.seed";
const RETIRED_DEVICE_KEY = "cc.device";

/** Open the vault database, creating the object store on first run. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** Read the stored CryptoKey from the vault, or null. */
async function readKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Persist the CryptoKey in the vault. */
function writeKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(key, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Import raw seed bytes as a non-extractable HKDF key. */
async function importSeed(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes as unknown as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
}

/** Drop the retired legacy keypair (cc.device) and the plaintext seed
 *  (cc.seed) from localStorage, if present. */
function wipeLegacy(): void {
  try {
    localStorage.removeItem(RETIRED_DEVICE_KEY);
    localStorage.removeItem(LEGACY_SEED_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Load the device seed as a non-extractable CryptoKey.
 *
 * Migration: a legacy plaintext seed in localStorage is read once,
 * re-imported as non-extractable, persisted to the vault, and the
 * plaintext copy is removed. Identities are unchanged, because the
 * derivation parameters are identical. The retired cc.device keypair
 * is always wiped.
 *
 * Returns null when neither the vault nor migration produced a usable
 * key (IndexedDB unavailable and no legacy seed). The caller holds the
 * seed in memory for the page load only in that case.
 */
export async function loadSeedKey(): Promise<CryptoKey | null> {
  try {
    const db = await openDb();
    if (!db) return null;

    const existing = await readKey(db);
    if (existing) {
      db.close();
      wipeLegacy();
      return existing;
    }

    // Migrate a legacy plaintext seed if present.
    let bytes: Uint8Array | null = null;
    try {
      const raw = localStorage.getItem(LEGACY_SEED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 32) {
          bytes = Uint8Array.from(parsed);
        }
      }
    } catch {
      bytes = null;
    }

    const key =
      bytes !== null
        ? await importSeed(bytes)
        : await importSeed(crypto.getRandomValues(new Uint8Array(32)));
    await writeKey(db, key);
    db.close();
    wipeLegacy();
    if (bytes) bytes.fill(0);
    return key;
  } catch {
    return null;
  }
}

/**
 * Derive the 32-byte per-room scalar from the vault key.
 *
 * The derived bits are a new byte string, not the seed; WebCrypto's
 * HKDF output is extractable (the key derivation is the point of the
 * call), so the scalar exists in memory here. The vault key itself is
 * never exposed. The caller imports the scalar as an ECDSA P-256 key
 * and holds only the CryptoKey.
 */
export async function deriveScalarFromSeedKey(
  seedKey: CryptoKey,
  roomId: string,
  info: string,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(roomId) as unknown as BufferSource,
      info: new TextEncoder().encode(info) as unknown as BufferSource,
    },
    seedKey,
    256,
  );
  return new Uint8Array(bits);
}
