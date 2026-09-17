// Task 21.1 — Silent-departure grace.
//
// Property: a member whose connection silently drops (closed laptop,
// lost signal — no clean leave) is evicted and the room re-seals only
// through server-verified facts: the REST registry stays the sole
// identity authority, the relay's live presence is the sole connection
// authority, and eviction is refused unless the target has genuinely
// been offline for the grace floor. The client only ever ACTS on the
// expiry when it is still the connected coordinator.

import { describe, expect, it } from "vitest";
import {
  authorizeEviction,
  EVICT_MIN_OFFLINE_MS,
  SILENT_GRACE_MS,
  stillSilentAtExpiry,
  type EvictFacts,
} from "../silent-grace";

function facts(over: Partial<EvictFacts> = {}): EvictFacts {
  return {
    roomExists: true,
    burned: false,
    callerInRegistry: true,
    targetInRegistry: true,
    targetIsCaller: false,
    callerConnected: true,
    targetConnected: false,
    targetOfflineMs: EVICT_MIN_OFFLINE_MS + 1_000,
    ...over,
  };
}

describe("authorizeEviction — the server's decision to seal out a silent leaver", () => {
  it("permits eviction when every fact agrees and the grace floor has passed", () => {
    expect(authorizeEviction(facts())).toEqual({ ok: true });
  });

  it("refuses eviction before the offline floor — a network blip is not a departure", () => {
    expect(authorizeEviction(facts({ targetOfflineMs: EVICT_MIN_OFFLINE_MS - 1 }))).toMatchObject({
      ok: false,
      reason: "too-soon",
    });
  });

  it("refuses eviction of a member the relay still sees connected", () => {
    expect(authorizeEviction(facts({ targetConnected: true }))).toMatchObject({
      ok: false,
      reason: "target-online",
    });
  });

  it("refuses eviction requested by a caller with no live relay presence (fail closed)", () => {
    expect(authorizeEviction(facts({ callerConnected: false }))).toMatchObject({
      ok: false,
      reason: "caller-offline",
    });
  });

  it("refuses eviction from a caller absent from the registry", () => {
    expect(authorizeEviction(facts({ callerInRegistry: false }))).toMatchObject({
      ok: false,
      reason: "caller-unknown",
    });
  });

  it("refuses eviction of a member already gone from the registry (idempotent path)", () => {
    expect(authorizeEviction(facts({ targetInRegistry: false }))).toMatchObject({
      ok: false,
      reason: "target-unknown",
    });
  });

  it("refuses self-eviction", () => {
    expect(authorizeEviction(facts({ targetIsCaller: true }))).toMatchObject({
      ok: false,
      reason: "self",
    });
  });

  it("refuses eviction in a burned room and in a missing room", () => {
    expect(authorizeEviction(facts({ burned: true }))).toMatchObject({ ok: false, reason: "burned" });
    expect(authorizeEviction(facts({ roomExists: false }))).toMatchObject({ ok: false, reason: "no-room" });
  });

  it("refuses eviction when presence is unavailable (offlineMs unknown, no relay clock)", () => {
    expect(authorizeEviction(facts({ targetOfflineMs: -1 }))).toMatchObject({
      ok: false,
      reason: "presence-unavailable",
    });
  });
});

describe("stillSilentAtExpiry — the client's gate before it acts on its own timer", () => {
  it("acts when still the connected coordinator of a member who is still quietly gone", () => {
    expect(
      stillSilentAtExpiry({
        selfConnected: true,
        memberPresent: true,
        memberConnected: false,
        isCoordinator: true,
      }),
    ).toBe(true);
  });

  it("never acts if the member returned during the grace window", () => {
    expect(
      stillSilentAtExpiry({
        selfConnected: true,
        memberPresent: true,
        memberConnected: true,
        isCoordinator: true,
      }),
    ).toBe(false);
  });

  it("never acts if the member already left the registry by another path", () => {
    expect(
      stillSilentAtExpiry({
        selfConnected: true,
        memberPresent: false,
        memberConnected: false,
        isCoordinator: true,
      }),
    ).toBe(false);
  });

  it("never acts if this client is no longer the coordinator", () => {
    expect(
      stillSilentAtExpiry({
        selfConnected: true,
        memberPresent: true,
        memberConnected: false,
        isCoordinator: false,
      }),
    ).toBe(false);
  });

  it("never acts if this client itself lost its connection", () => {
    expect(
      stillSilentAtExpiry({
        selfConnected: false,
        memberPresent: true,
        memberConnected: false,
        isCoordinator: true,
      }),
    ).toBe(false);
  });
});

describe("constants — the grace is measured, not momentary", () => {
  it("the client grace exceeds the server's offline floor (clock skew tolerance)", () => {
    expect(SILENT_GRACE_MS).toBeGreaterThan(EVICT_MIN_OFFLINE_MS);
  });

  it("the client grace absorbs ordinary reconnect blips but is not a session", () => {
    expect(SILENT_GRACE_MS).toBeGreaterThanOrEqual(90_000);
    expect(SILENT_GRACE_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
