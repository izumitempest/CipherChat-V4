// Task 19.6: HARDENING (P2)
//
// Properties:
//  - The relay rate-limits every socket: sustained 20 frames/sec with
//    a bounded burst; excess frames are dropped.
//  - POST /api/rooms is limited to 5 rooms per minute per IP.
//  - A frame exceeding the size cap is refused and the socket is a
//    candidate for hard disconnect.
// These are pure modules so the properties are testable without a
// live relay.

import { describe, it, expect } from "vitest";
import {
  TokenBucket,
  IpRateLimiter,
  frameSizeWithinCap,
  FRAME_SIZE_CAP_BYTES,
  RELAY_FRAME_RATE,
  RELAY_FRAME_BURST,
  ROOM_CREATE_PER_MIN,
} from "@/lib/rate-limit";

describe("relay per-socket token bucket (20 frames/sec)", () => {
  it("allows a bounded burst then throttles to the refill rate", () => {
    let now = 1_000_000;
    const bucket = new TokenBucket(
      { ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST },
      () => now,
    );
    // The full burst passes instantly:
    for (let i = 0; i < RELAY_FRAME_BURST; i++) {
      expect(bucket.tryTake()).toBe(true);
    }
    // The next frame is over budget:
    expect(bucket.tryTake()).toBe(false);
    // One second of refill = 20 more frames, not more:
    now += 1000;
    for (let i = 0; i < RELAY_FRAME_RATE; i++) {
      expect(bucket.tryTake()).toBe(true);
    }
    expect(bucket.tryTake()).toBe(false);
  });

  it("partial refill grants proportional credit", () => {
    let now = 1_000_000;
    const bucket = new TokenBucket(
      { ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST },
      () => now,
    );
    for (let i = 0; i < RELAY_FRAME_BURST; i++) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);
    now += 100; // 0.1s → 2 tokens
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });
});

describe("room creation IP limiter (5 rooms/min)", () => {
  it("allows 5 creations per IP per minute, blocks the 6th, other IPs unaffected", () => {
    let now = 2_000_000;
    const limiter = new IpRateLimiter(
      { limit: ROOM_CREATE_PER_MIN, windowMs: 60_000 },
      () => now,
    );
    for (let i = 0; i < ROOM_CREATE_PER_MIN; i++) {
      expect(limiter.allow("1.2.3.4")).toBe(true);
    }
    expect(limiter.allow("1.2.3.4")).toBe(false);
    expect(limiter.allow("5.6.7.8")).toBe(true);
    now += 60_001;
    expect(limiter.allow("1.2.3.4")).toBe(true);
  });
});

describe("frame size cap", () => {
  it("accepts a normal control frame and a normal file chunk frame", () => {
    const control = JSON.stringify({
      v: 2,
      roomId: "R",
      kv: 1,
      from: "A",
      id: "x",
      iv: "i".repeat(16),
      ct: "c".repeat(28_000), // 20480+16 bytes → ~27.3k b64 chars
    });
    expect(frameSizeWithinCap(control)).toBe(true);

    const chunk = JSON.stringify({
      v: 2,
      roomId: "R",
      kv: 1,
      from: "A",
      id: "x",
      iv: "i".repeat(16),
      ct: "c".repeat(87_500), // 65536+16 bytes → ~87.4k b64 chars
    });
    expect(frameSizeWithinCap(chunk)).toBe(true);
  });

  it("refuses frames over the cap (memory-DoS guard)", () => {
    const huge = JSON.stringify({
      v: 2,
      roomId: "R",
      kv: 1,
      from: "A",
      id: "x",
      iv: "i".repeat(16),
      ct: "c".repeat(FRAME_SIZE_CAP_BYTES), // way over
    });
    expect(frameSizeWithinCap(huge)).toBe(false);
  });
});
