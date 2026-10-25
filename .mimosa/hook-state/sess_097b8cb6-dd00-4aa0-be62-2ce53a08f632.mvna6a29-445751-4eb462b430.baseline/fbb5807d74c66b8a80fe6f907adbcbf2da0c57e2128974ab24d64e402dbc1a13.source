// Task 21.1: Silent-departure grace.
//
// A member whose connection silently drops (closed laptop, dead
// signal, no clean leave) keeps the room key forever unless someone
// acts. This module holds the decision logic for the two authorities
// that close that gap:
//
//   - the SERVER (REST /evict) decides with `authorizeEviction`:
//     the registry is the identity authority, the relay's live
//     presence is the connection authority, and the target must have
//     been offline for the floor before the room writes them out and
//     bumps the epoch (the rotation ledger).
//   - the CLIENT decides with `stillSilentAtExpiry` whether its own
//     grace timer still means anything at the moment it fires.
//
// Both are pure functions so the properties are unit-testable; the
// route and the store only gather facts and apply the decision.

/** How long a silent leaver stays in the room before the room rotates
 *  its key (client-side grace timer). Long enough to absorb a laptop
 *  waking up or a train tunnel; short enough that a stolen key stops
 *  working soon. */
export const SILENT_GRACE_MS = 120_000;

/** Server-side floor on how long the target must have been offline
 *  before eviction is permitted. Must stay below SILENT_GRACE_MS so
 *  an honest coordinator's request always passes. */
export const EVICT_MIN_OFFLINE_MS = 60_000;

/** Marker for "the relay had no clock for this member": the caller
 *  could not establish the offline duration, so eviction fails
 *  closed. */
export const OFFLINE_UNKNOWN = -1;

export interface EvictFacts {
  roomExists: boolean;
  burned: boolean;
  /** caller is an active registry member of this room */
  callerInRegistry: boolean;
  /** target is an active registry member of this room */
  targetInRegistry: boolean;
  targetIsCaller: boolean;
  /** caller has a live relay socket in the room (relay presence) */
  callerConnected: boolean;
  /** target has a live relay socket in the room (relay presence) */
  targetConnected: boolean;
  /** how long the target has been offline, per the relay's clock
   *  (or OFFLINE_UNKNOWN when no clock was available) */
  targetOfflineMs: number;
}

export type EvictReason =
  | "no-room"
  | "burned"
  | "caller-unknown"
  | "target-unknown"
  | "self"
  | "caller-offline"
  | "target-online"
  | "too-soon"
  | "presence-unavailable";

export type EvictVerdict = { ok: true } | { ok: false; reason: EvictReason };

/** The server's decision. Order matters only for which reason wins;
 * every refusal is independent and conservative. */
export function authorizeEviction(facts: EvictFacts): EvictVerdict {
  if (!facts.roomExists) return { ok: false, reason: "no-room" };
  if (facts.burned) return { ok: false, reason: "burned" };
  if (!facts.callerInRegistry) return { ok: false, reason: "caller-unknown" };
  if (!facts.targetInRegistry) return { ok: false, reason: "target-unknown" };
  if (facts.targetIsCaller) return { ok: false, reason: "self" };
  // Presence authority unavailable or unfavorable: fail closed. No
  // eviction happens without the relay vouching that the caller is
  // live and the target is not.
  if (!facts.callerConnected) return { ok: false, reason: "caller-offline" };
  if (facts.targetConnected) return { ok: false, reason: "target-online" };
  if (facts.targetOfflineMs === OFFLINE_UNKNOWN) {
    return { ok: false, reason: "presence-unavailable" };
  }
  if (facts.targetOfflineMs < EVICT_MIN_OFFLINE_MS) {
    return { ok: false, reason: "too-soon" };
  }
  return { ok: true };
}

export interface ExpiryFacts {
  /** this client's own relay presence is live */
  selfConnected: boolean;
  /** the silent member is still in the local registry */
  memberPresent: boolean;
  /** the silent member is still marked offline */
  memberConnected: boolean;
  /** this client is still the expected coordinator */
  isCoordinator: boolean;
}

/** The client's gate at the moment its grace timer fires. Every
 *  condition must still hold: the grace window is a promise to keep
 *  watching, not a decision made once. */
export function stillSilentAtExpiry(facts: ExpiryFacts): boolean {
  return (
    facts.selfConnected &&
    facts.memberPresent &&
    facts.memberConnected === false &&
    facts.isCoordinator
  );
}
