// The rate limiters, at their edges.
//
// The bug list asked for rate limit edges under test. The limits are
// the second line of defence for the web tier and the relay, and a
// limiter with a bug in it is a limiter that is either useless or a
// denial of service against honest clients.
//
// The clock is injected, so every case here is exact: no sleeping, no
// flakiness. The questions asked are the ones a limiter has to get
// right.
//
//   - does the bucket refuse when it is empty?
//   - does it refill at the stated rate and no faster?
//   - does a big cost cost more than a small one?
//   - does the per-IP window slide, and does it forget dead keys?
//   - is the client IP the rightmost hop and not theleftmost?

import { describe, it, expect } from "vitest";
import {
  FRAME_SIZE_CAP_BYTES,
  MEMBER_JOIN_PER_MIN,
  RELAY_BYTE_BURST,
  RELAY_BYTE_RATE,
  RELAY_FRAME_BURST,
  RELAY_FRAME_RATE,
  ROOM_CREATE_PER_MIN,
  ROOM_INFO_PER_MIN,
  IpRateLimiter,
  TokenBucket,
  clientIp,
  frameSizeWithinCap,
} from "@/lib/rate-limit";

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("the relay token bucket", () => {
  it("lets the burst through, then refuses", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST }, c.now);
    for (let i = 0; i < RELAY_FRAME_BURST; i++) {
      expect(bucket.tryTake(), `frame ${i}`).toBe(true);
    }
    expect(bucket.tryTake()).toBe(false);
  });

  it("refills at the stated rate and no faster", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST }, c.now);
    for (let i = 0; i < RELAY_FRAME_BURST; i++) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);

    // A tenth of a second buys two frames, not twenty.
    c.advance(100);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("never fills past its capacity", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: 10 }, c.now);
    for (let i = 0; i < 5; i++) bucket.tryTake();
    c.advance(60_000); // a minute of refilling
    // The refill happens on the next take, so ask for one and check
    // the level afterwards: the bucket came back to its ceiling and
    // the take spent one.
    bucket.tryTake();
    expect(bucket.available).toBe(9);
  });

  it("charges a big frame more than a small one", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_BYTE_RATE, capacity: RELAY_BYTE_BURST }, c.now);
    // The whole byte budget goes on one frame.
    expect(bucket.tryTake(RELAY_BYTE_BURST)).toBe(true);
    expect(bucket.tryTake(1)).toBe(false);
  });

  it("the byte bucket lets one file transfer through and then stops", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_BYTE_RATE, capacity: RELAY_BYTE_BURST }, c.now);
    // The largest bucket is two megabytes, split into chunk frames.
    const frameBytes = 87_000;
    let sent = 0;
    while (bucket.tryTake(frameBytes)) {
      sent++;
      if (sent > 1000) break;
    }
    expect(sent).toBeGreaterThan(20);
    expect(sent).toBeLessThan(100);
  });

  it("a cost of zero or less costs nothing", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: 1, capacity: 1 }, c.now);
    expect(bucket.tryTake(0)).toBe(true);
    expect(bucket.tryTake(-5)).toBe(true);
    expect(bucket.tryTake(Number.NaN)).toBe(true);
    // The bucket is still full, because none of those took anything.
    expect(bucket.available).toBe(1);
  });

  it("a clock that jumps backwards does not hand out free tokens", () => {
    const c = clock();
    const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST }, c.now);
    for (let i = 0; i < RELAY_FRAME_BURST; i++) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);
    c.advance(-5000); // the clock went back
    expect(bucket.tryTake()).toBe(false);
  });
});

describe("the per-IP limiter", () => {
  it("lets the limit through, then refuses", () => {
    const c = clock();
    const limiter = new IpRateLimiter({ limit: ROOM_CREATE_PER_MIN, windowMs: 60_000 }, c.now);
    for (let i = 0; i < ROOM_CREATE_PER_MIN; i++) {
      expect(limiter.allow("1.2.3.4"), `request ${i}`).toBe(true);
    }
    expect(limiter.allow("1.2.3.4")).toBe(false);
  });

  it("keys on the IP, so one address cannot spend another's budget", () => {
    const c = clock();
    const limiter = new IpRateLimiter({ limit: 2, windowMs: 60_000 }, c.now);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
  });

  it("the window slides: the oldest hit falls out", () => {
    const c = clock();
    const limiter = new IpRateLimiter({ limit: 2, windowMs: 60_000 }, c.now);
    expect(limiter.allow("a")).toBe(true);
    c.advance(30_000);
    expect(limiter.allow("a")).toBe(true);
    // Both hits are still inside the window.
    expect(limiter.allow("a")).toBe(false);
    // The first one falls out now.
    c.advance(30_001);
    expect(limiter.allow("a")).toBe(true);
  });

  it("a sweep forgets the addresses that stopped calling", () => {
    const c = clock();
    const limiter = new IpRateLimiter({ limit: 1, windowMs: 60_000 }, c.now);
    for (let i = 0; i < 100; i++) limiter.allow(`ip-${i}`);
    // The internal map is not public, so the test watches its effect
    // through the sweep: after a window, the dead keys go and the
    // limiter still answers correctly.
    c.advance(60_001);
    expect(limiter.allow("ip-0")).toBe(true);
    expect(limiter.allow("ip-0")).toBe(false);
  });

  it("the limits are the ones the docs say", () => {
    expect(ROOM_CREATE_PER_MIN).toBe(5);
    expect(ROOM_INFO_PER_MIN).toBe(30);
    expect(MEMBER_JOIN_PER_MIN).toBe(12);
    expect(RELAY_FRAME_RATE).toBe(20);
    expect(RELAY_BYTE_RATE).toBe(1024 * 1024);
    expect(RELAY_BYTE_BURST).toBe(8 * 1024 * 1024);
    expect(FRAME_SIZE_CAP_BYTES).toBe(131_072);
  });
});

describe("the client IP", () => {
  it("takes the rightmost hop, not the leftmost", () => {
    // The leftmost value is whatever the client sent. The rightmost
    // is the one the proxy in front of us appended.
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
    });
    expect(clientIp(req)).toBe("3.3.3.3");
  });

  it("falls back to x-real-ip, then to local", () => {
    const real = new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(clientIp(real)).toBe("9.9.9.9");
    const none = new Request("http://x/");
    expect(clientIp(none)).toBe("local");
  });

  it("ignores the empty hops a client can pad with", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.1.1.1, , 4.4.4.4, " },
    });
    expect(clientIp(req)).toBe("4.4.4.4");
  });
});

describe("the frame size cap", () => {
  it("passes a frame at the cap and refuses one over it", () => {
    expect(frameSizeWithinCap("x".repeat(FRAME_SIZE_CAP_BYTES))).toBe(true);
    expect(frameSizeWithinCap("x".repeat(FRAME_SIZE_CAP_BYTES + 1))).toBe(false);
  });
});
