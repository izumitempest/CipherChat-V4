// Task 22.3: ADMISSION POLICY FOR THE MEMBER CAP
//
// Property: a known member (their pubkey is already in the registry)
// always rejoins: the cap can never lock a legitimate member out of
// their own room. A stranger is admitted only while the count of
// recently-seen members is below the cap, so a code-holder without
// the password cannot permanently fill the room with throwaway keys.

import { describe, it, expect } from "vitest";
import { decideAdmission, ROOM_MEMBER_CAP } from "@/lib/admission";

describe("admission policy for the member cap", () => {
  it("an existing member always rejoins — even when the room is full", () => {
    expect(decideAdmission({ existingMemberId: "m1", recentlySeenCount: ROOM_MEMBER_CAP })).toBe(
      "rejoin",
    );
    expect(decideAdmission({ existingMemberId: "m1", recentlySeenCount: 999 })).toBe("rejoin");
    expect(decideAdmission({ existingMemberId: null, recentlySeenCount: 0 })).toBe("admit");
    expect(decideAdmission({ recentlySeenCount: 0 })).toBe("admit");
  });

  it("admits below the cap and refuses at the cap (>= means full)", () => {
    expect(decideAdmission({ recentlySeenCount: ROOM_MEMBER_CAP - 1 })).toBe("admit");
    expect(decideAdmission({ recentlySeenCount: ROOM_MEMBER_CAP })).toBe("full");
    expect(decideAdmission({ recentlySeenCount: ROOM_MEMBER_CAP + 5 })).toBe("full");
  });

  it("the boundary is exact: cap-1 admits, cap refuses", () => {
    for (const cap of [1, 2, 12, 50]) {
      expect(decideAdmission({ recentlySeenCount: cap - 1, cap })).toBe("admit");
      expect(decideAdmission({ recentlySeenCount: cap, cap })).toBe("full");
    }
  });

  it("a cap override is respected", () => {
    expect(decideAdmission({ recentlySeenCount: 2, cap: 3 })).toBe("admit");
    expect(decideAdmission({ recentlySeenCount: 3, cap: 3 })).toBe("full");
    expect(decideAdmission({ recentlySeenCount: 3, cap: 100 })).toBe("admit");
  });
});
