// Time formatting for quiet metadata display: small, sans, never
// shouting.

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** TTL remaining: "42s" under a minute, "4:37" under an hour,
 *  "1h 05m" above, "3d 04h" past a day. */
export function fmtTtlRemaining(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** A lifetime as a compact label: 42s · 1m 30s · 5m · 1h 05m · 8h. */
export function fmtTtlShort(sec: number): string {
  if (sec <= 0) return "Off";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/** A lifetime in the human voice: "42 seconds", "1 minute 30 seconds",
 *  "5 minutes", "1 hour", "8 hours". */
export function fmtTtlLong(sec: number): string {
  if (sec <= 0) return "Off";
  const parts: string[] = [];
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  if (s) parts.push(`${s} ${s === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** iMessage-style rule: consecutive messages within 3 minutes group together. */
export const GROUP_WINDOW_MS = 3 * 60 * 1000;
