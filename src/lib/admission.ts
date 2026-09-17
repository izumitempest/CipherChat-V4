// Admission policy for the member cap — pure, so the cap's properties
// are testable without a database.
//
// The cap's purpose (stated honestly): stop a code-holder WITHOUT the
// password from permanently locking the room with throwaway keys. It
// counts only members seen within the freshness window
// (MEMBER_FRESH_WINDOW_MS), so abandoned memberships age out instead
// of squatting seats forever. A coordinated attacker with many IPs
// and keys can still exceed it — that is presence noise, not a
// confidentiality issue (matching the Task 19 acceptance review's
// assessment). A KNOWN member (pubkey already registered) always
// rejoins: the cap can never lock a legitimate member out of their
// own room.

import { MEMBER_FRESH_WINDOW_MS } from "./rate-limit";

export type AdmissionDecision = "rejoin" | "admit" | "full";

/** Maximum recently-seen members per room (the soft cap). */
export const ROOM_MEMBER_CAP = 12;

/** The one place the member-cap policy lives.
 *  - existingMemberId → "rejoin" (known pubkey, always admitted)
 *  - recentlySeenCount >= cap → "full" (freshness-windowed soft cap)
 *  - otherwise → "admit"
 *
 *  `recentlySeenCount` is the caller's count of active members with
 *  lastSeenAt within MEMBER_FRESH_WINDOW_MS. */
export function decideAdmission(input: {
  existingMemberId?: string | null;
  recentlySeenCount: number;
  cap?: number;
}): AdmissionDecision {
  if (input.existingMemberId) return "rejoin";
  const cap = input.cap ?? ROOM_MEMBER_CAP;
  return input.recentlySeenCount >= cap ? "full" : "admit";
}
