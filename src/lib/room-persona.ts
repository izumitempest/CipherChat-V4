// Room personas: one browser, several windows, one room.
//
// PROBLEM (reported in the wild, Task 48): every tab of a browser
// shares the seed vault, so every tab derives the SAME per-room
// signing identity. The member registry is keyed by pubkey, so a
// second tab "joining" the room re-joins as the FIRST tab's member:
// the member count never grows, the second tab's messages are
// attributed to the first member in everyone else's view, and the
// two tabs overwrite each other's session ECDH key in the registry
// (key delivery after a rotation reaches only whichever tab
// registered last).
//
// FIX: the first tab to enter a room (per origin) claims a Web Lock
// and keeps the VAULT identity, byte-identical to the single-tab
// behavior: fingerprints, verification marks and "returned"
// recognition all survive. Any additional concurrent tab takes a
// TAB PERSONA: an identity derived from the same non-extractable
// vault key but under a distinct HKDF info prefix
// ("cc-sig-tab-v1:<nonce>"), so it registers as its own member with
// its own alias and its own session ECDH key. The nonce lives in
// sessionStorage (per-tab, survives a refresh of that tab, dies with
// it), so a persona is STICKY: identities never flip between windows,
// even if the primary lock is momentarily free during a reload.
//
// Lock lifecycle: claimed at room entry (create/join, the two places
// a room identity is derived), released when this tab's session for
// the room ends (leave/burn/expiry), and auto-released by the browser
// when the tab closes or crashes. There is no stale-lock failure
// mode: a crashed primary tab frees the role for the next window.
//
// Degradation: browsers without navigator.locks (Safari < 15.4, old
// embedded views) keep the legacy behavior: every tab derives the
// vault identity. The collision returns, but nothing new breaks, and
// real members on their own devices are unaffected.
//
// Security note: the persona nonce is not a secret. It only diversifies
// an ephemeral per-tab identity derived from the same non-extractable
// vault key; reading it reveals nothing about the vault seed, and the
// identity it selects dies with the tab.

export type PersonaRole = "primary" | "tab";

const PERSONA_PREFIX = "cc-sig-tab-v1";
const nonceKey = (roomId: string) => `cc.tabpersona.${roomId}`;
const lockName = (roomId: string) => `cc:room:${roomId}`;

/** Release functions for primary locks this page load holds. */
const held = new Map<string, () => void>();
/** The role this page load took per room (read after the identity
 *  derivation; "primary" for rooms we have not entered). */
const roles = new Map<string, PersonaRole>();

/** Pure decision core (unit-tested without browser APIs): given an
 *  existing tab nonce and lock availability, which role does this tab
 *  take? A tab that was ever a persona stays one — stickiness is what
 *  keeps identities from flipping between windows. */
export function decidePersonaRole(nonce: string | null, lockAvailable: boolean): PersonaRole {
  if (nonce) return "tab";
  return lockAvailable ? "primary" : "tab";
}

/** The HKDF info prefix for this tab's persona in a room. Stable for
 *  the life of the tab (sessionStorage), distinct from every other
 *  tab and from the primary identity's "cc-sig-v1". */
export function personaInfoPrefix(roomId: string): string {
  return `${PERSONA_PREFIX}:${personaNonce(roomId)}`;
}

/** Same, from an explicit nonce (the pure form, for tests). */
export function personaInfoPrefixFromNonce(nonce: string): string {
  return `${PERSONA_PREFIX}:${nonce}`;
}

function readNonce(roomId: string): string | null {
  try {
    return sessionStorage.getItem(nonceKey(roomId));
  } catch {
    return null; // private mode / no storage: a fresh nonce each call
  }
}

function writeNonce(roomId: string, nonce: string): void {
  try {
    sessionStorage.setItem(nonceKey(roomId), nonce);
  } catch {
    /* private mode: the persona is stable only within this call */
  }
}

function personaNonce(roomId: string): string {
  let nonce = readNonce(roomId);
  if (!nonce) {
    nonce = crypto.randomUUID().replace(/-/g, "");
    writeNonce(roomId, nonce);
  }
  return nonce;
}

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: { name: string; mode: string } | null) => Promise<void> | void,
  ): Promise<void>;
}

function lockManager(): LockManagerLike | null {
  const nav = navigator as Navigator & { locks?: LockManagerLike };
  return nav.locks ?? null;
}

/** Try to claim the room's primary lock WITHOUT waiting. Resolves true
 *  when the lock was granted (and is now held until release / tab
 *  death), false when another tab of this origin holds it. */
function tryClaimPrimary(roomId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const locks = lockManager();
    if (!locks) {
      resolve(false);
      return;
    }
    let settled = false;
    locks
      .request(lockName(roomId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          if (!settled) {
            settled = true;
            resolve(false);
          }
          return;
        }
        // Granted: report now, then hold the lock open with a promise
        // that only releaseRoomPersona() settles.
        if (!settled) {
          settled = true;
          resolve(true);
        }
        return new Promise<void>((release) => {
          held.set(roomId, release);
        });
      })
      .catch(() => {
        // Lock manager errors (rare, e.g. nested-join edge in odd
        // browsers): degrade to persona, never block the join.
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
  });
}

/** Decide and record this tab's role for a room, called at the exact
 *  moment a room identity is about to be derived (create/join). */
export async function acquireRoomPersona(roomId: string): Promise<PersonaRole> {
  // Already the primary for this room in this tab (a re-join without
  // a page refresh, e.g. unlock after leave): keep the role, do not
  // re-request a lock we already hold.
  if (roles.get(roomId) === "primary" && held.has(roomId)) {
    return "primary";
  }
  // Sticky persona: a tab that was ever a persona in this room stays
  // one, even if the primary lock is free (the primary window may be
  // mid-reload). Checked BEFORE the lock attempt so a persona never
  // grabs the primary lock it would not use.
  const nonce = readNonce(roomId);
  if (roles.get(roomId) === "tab" || nonce) {
    roles.set(roomId, "tab");
    return "tab";
  }
  const locks = lockManager();
  // Without lock support this tab behaves as the historical single
  // identity (primary), collisions included; nothing new breaks.
  const lockAvailable = locks ? await tryClaimPrimary(roomId) : true;
  const role = decidePersonaRole(null, lockAvailable);
  if (role === "tab") personaNonce(roomId); // persist the nonce now
  roles.set(roomId, role);
  return role;
}

/** The role this page load took for a room. "primary" for rooms this
 *  tab has not entered (and for tabs without lock support, which keep
 *  the historical single-identity behavior). */
export function roomPersona(roomId: string): PersonaRole {
  return roles.get(roomId) ?? "primary";
}

/** End this tab's claim on a room's primary role: the session is over
 *  (leave / burn / expiry), so the next window to enter may be the
 *  primary. Safe to call for persona tabs (releases nothing) and
 *  unknown rooms. The persona nonce is deliberately KEPT: a tab that
 *  re-joins the room continues under its persona identity ("returned"
 *  recognition), and it dies naturally with the tab. */
export function releaseRoomPersona(roomId: string): void {
  const release = held.get(roomId);
  held.delete(roomId);
  roles.delete(roomId);
  if (release) release();
}
