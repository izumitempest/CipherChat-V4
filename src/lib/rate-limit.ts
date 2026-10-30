// Rate limiting for the relay and the room-creation API. Pure modules
// with injectable clocks so the properties are unit-testable.

/** sustained frames per second per relay socket */
export const RELAY_FRAME_RATE = 20;
/** burst capacity per relay socket (a full file transfer is 45 frames) */
export const RELAY_FRAME_BURST = 64;
/** sustained bytes per second per relay socket. The frame counter
 *  alone was not enough: a frame can carry 128 KB, so 20 frames a
 *  second was 2.5 MB a second out of one socket. */
export const RELAY_BYTE_RATE = 1024 * 1024; // 1 MB/s
/** burst capacity in bytes per relay socket: one file transfer
 *  (44 padded frames, about 4 MB) fits, and then the bucket is
 *  mostly empty again */
export const RELAY_BYTE_BURST = 8 * 1024 * 1024; // 8 MB
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
 *  `capacity`, then throttled to the refill rate.
 *
 *  The unit is whatever the caller cares about: frames (one per
 *  tryTake) or bytes (the frame's size per tryTake). One bucket, two
 *  currencies. */
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

  /** Take `cost` units (1 by default). False when the bucket is
   *  short: the caller drops the frame. */
  tryTake(cost = 1): boolean {
    if (!Number.isFinite(cost) || cost <= 0) return true;
    const t = this.now();
    const elapsed = (t - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.opts.capacity,
        this.tokens + elapsed * this.opts.ratePerSec,
      );
      this.last = t;
    }
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Units left, for tests and for logging. */
  get available(): number {
    return this.tokens;
  }
}

/** Which IP a request came from, for per-IP limiting.
 *
 * Trust model: we take the RIGHTMOST hop of X-Forwarded-For, because
 * the only proxy we trust is the one directly in front of us (Caddy in
 * the compose deployment), and that proxy APPENDS the real client IP
 * to whatever the client sent. The first element is therefore
 * attacker-controlled ("spoofed, ..., real") and must never key a
 * limiter: parsing it first-handedly made every per-IP limit trivially
 * bypassable.
 * With no XFF (dev, direct exposure) we fall back to X-Real-Ip, which
 * Caddy-style proxies set exclusively. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip") ?? "local";
}

/** Sliding-window limiter keyed by IP (room creation). */
export class IpRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly opts: { limit: number; windowMs: number },
    private readonly now: () => number = Date.now,
  ) {}

  allow(ip: string): boolean {
    const t = this.now();
    this.sweep(t);
    const arr = (this.hits.get(ip) ?? []).filter((x) => t - x < this.opts.windowMs);
    if (arr.length >= this.opts.limit) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(ip, arr);
    return true;
  }

  /** Evict dead keys so the map cannot grow without bound. Without
   *  this, a client spraying unique IPs (or unique spoofed XFF values,
   *  before the rightmost-hop fix) plants one permanent Map entry per
   *  request — a slow memory-exhaustion of the web tier. One sweep per
   *  window; O(keys). */
  private sweep(t: number): void {
    if (t - this.lastSweep < this.opts.windowMs) return;
    this.lastSweep = t;
    for (const [ip, arr] of this.hits) {
      if (!arr.some((x) => t - x < this.opts.windowMs)) this.hits.delete(ip);
    }
  }
}

/** A socket message (the JSON the relay received) within the size cap? */
export function frameSizeWithinCap(socketMessageJson: string): boolean {
  return socketMessageJson.length <= FRAME_SIZE_CAP_BYTES;
}
