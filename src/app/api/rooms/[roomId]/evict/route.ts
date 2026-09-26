import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter } from "@/lib/rate-limit";
import { authorizeEviction, OFFLINE_UNKNOWN } from "@/lib/silent-grace";

// POST /api/rooms/:roomId/evict. Lock out a SILENT leaver.
//
// A member whose connection dropped without a clean leave keeps the
// room key until the room re-seals. This endpoint is the server half
// of that re-seal: the connected coordinator (smallest memberId
// among live members) asks us to write the silent member out of the
// registry and bump the epoch (the rotation ledger).
//
// Graded authority (adversarial review 19-10 rules preserved):
//   - THIS route remains the only registry writer, the authoritative
//     source for identity. The relay's live presence snapshot is the
//     authoritative source for connections. We ask it directly,
//     server-to-server, and we FAIL CLOSED without the token or when
//     it cannot vouch for both the caller (live) and the target
//     (gone long enough)
//
// An abuser who knows only the roomId gains nothing beyond a
// nuisance rotation while someone is away. This is the same accepted
// risk class as an insider nuisance-rotating, and the member simply
// re-enters with the password afterwards.

const evictLimiter = new IpRateLimiter({ limit: 30, windowMs: 60_000 });

const PRESENCE_URL_BASE = process.env.RELAY_PRESENCE_URL ?? "http://127.0.0.1:3004";
const PRESENCE_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

interface PresenceSnapshot {
  connected?: string[];
  offlineSince?: Record<string, number>;
}

async function fetchPresence(roomId: string): Promise<PresenceSnapshot | null> {
  if (!PRESENCE_TOKEN) return null; // fail closed: no token, no authority
  try {
    const res = await fetch(`${PRESENCE_URL_BASE}/presence/${encodeURIComponent(roomId)}`, {
      headers: { "x-internal-token": PRESENCE_TOKEN },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PresenceSnapshot;
  } catch {
    return null; // relay unreachable, so fail closed
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!evictLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }

  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    memberId?: string; // the silent leaver to write out
    callerId?: string; // the (coordinator) member asking
  } | null;
  if (!body?.memberId || !body?.callerId) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    // Indistinguishable from success to unauthenticated callers.
    // The room's existence is not confirmed to strangers.
    return NextResponse.json({ ok: true });
  }

  const [caller, target] = await Promise.all([
    db.member.findFirst({ where: { id: body.callerId, roomId, active: true } }),
    db.member.findFirst({ where: { id: body.memberId, roomId, active: true } }),
  ]);

  const snapshot = await fetchPresence(roomId);
  const connected = new Set(snapshot?.connected ?? []);
  const now = Date.now();
  let targetOfflineMs: number = OFFLINE_UNKNOWN;
  const offlineSince = snapshot?.offlineSince?.[body.memberId];
  if (typeof offlineSince === "number" && Number.isFinite(offlineSince)) {
    targetOfflineMs = Math.max(0, now - offlineSince);
  } else if (target) {
    // The relay never saw them in this process, but the registry's
    // lastSeenAt is a usable fallback clock (set at their last join).
    targetOfflineMs = Math.max(0, now - target.lastSeenAt.getTime());
  }

  const verdict = authorizeEviction({
    roomExists: true,
    burned: room.burned,
    callerInRegistry: !!caller,
    targetInRegistry: !!target,
    targetIsCaller: body.memberId === body.callerId,
    callerConnected: connected.has(body.callerId),
    targetConnected: connected.has(body.memberId),
    targetOfflineMs,
  });
  if (!verdict.ok) {
    // 409: the request was understood, the state disagrees.
    return NextResponse.json({ error: verdict.reason }, { status: 409 });
  }

  await db.member.updateMany({
    where: { id: body.memberId, roomId, active: true },
    data: { active: false },
  });
  const updated = await db.room.update({
    where: { id: roomId },
    data: { epoch: { increment: 1 } },
  });
  return NextResponse.json({ ok: true, epoch: updated.epoch });
}
