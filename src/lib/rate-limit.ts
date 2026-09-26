// Rate limiting for the relay and the room-creation API. Pure modules
// with injectable clocks so the properties are unit-testable.

/** sustained frames per second per relay socket */
export const RELAY_FRAME_RATE = 20;
/** burst capacity per relay socket (a full file transfer is 45 frames) */
export const RELAY_FRAME_BURST = 64;
/** room creations per minute per IP */
export const ROOM_CREATE_PER_MIN = 5;
/** hard cap on a single socket message (memory-DoS guard) */
export const FRAME_SIZE_CAP_BYTES = 131_072; // 128 KB
/** room-info reads per minute per IP (GET room info: the invite
 *  surface and the existence/epoch oracle) */
export const ROOM_INFO_PER_MIN = 30;
/** member joins per minute per IP (registry writes) */
export const MEMBER_JOIN_PER_MIN = 12;
/** member-cap freshness window: only members whose lastSeenAt falls
 *  within this window count against the cap (see lib/admission.ts) */
export const MEMBER_FRESH_WINDOW_MS = 15 * 60_000;

/** Classic token bucket: sustained `ratePerSec`, instant burst up to
 *  `capacity`, then throttled to the refill rate. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly opts: { ratePerSec: number; capacity: number },
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = opts.capacity;
    this.last = now();
  }

  tryTake(): boolean {
    const t = this.now();
    const elapsed = (t - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.opts.capacity,
        this.tokens + elapsed * this.opts.ratePerSec,
      );
      this.last = t;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Sliding-window limiter keyed by IP (room creation). */
export class IpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly opts: { limit: number; windowMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  allow(ip: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(ip) ?? []).filter((x) => t - x < this.opts.windowMs);
    if (arr.length >= this.opts.limit) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(ip, arr);
    return true;
  }
}

/** A socket message (the JSON the relay received) within the size cap? */
export function frameSizeWithinCap(socketMessageJson: string): boolean {
  return socketMessageJson.length <= FRAME_SIZE_CAP_BYTES;
}
