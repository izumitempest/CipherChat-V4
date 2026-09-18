import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter } from "@/lib/rate-limit";

// POST /api/rooms/:roomId/report — the abuse path.
//
// The architecture permits exactly one act of moderation: ending the
// room. There is no content to review (the server is blind), no
// member to suspend (identity is per-room and derived), no history
// to scrub (none is stored). What an operator CAN do — and what this
// endpoint does — is terminate the room by its ID: the registry is
// destroyed, the verifier is withdrawn, and the relay tells every
// connected member the room is gone (they run the same burn sequence
// a creator's burn triggers).
//
// Threat honesty, stated in DESIGN.md §6 and repeated here because
// it is the design's load-bearing limit: anyone who knows a room ID
// can call this. Room IDs are unguessable in practice, the endpoint
// is tightly rate-limited per IP, unknown and already-burned rooms
// answer exactly like success (existence is never confirmed to a
// stranger), and the reason is capped. A room killed this way is
// indistinguishable, to its members, from a creator's burn — the
// griefing ceiling is "a room you already knew about dies", the same
// ceiling a leaked creator token already has.

const reportLimiter = new IpRateLimiter({ limit: 5, windowMs: 60_000 });
const REASON_MAX = 500;

const PRESENCE_URL_BASE = process.env.RELAY_PRESENCE_URL ?? "http://127.0.0.1:3004";
const PRESENCE_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/** Best-effort relay termination. The room is already dead in the
 * registry when this runs; a relay that cannot be reached leaves
 * connected members to discover it on their next poll — never a
 * resurrection. */
async function notifyRelay(roomId: string): Promise<void> {
  if (!PRESENCE_TOKEN) return;
  try {
    await fetch(`${PRESENCE_URL_BASE}/terminate/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { "x-internal-token": PRESENCE_TOKEN },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
  } catch {
    // The registry burn already happened; the relay will catch up.
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!reportLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }

  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    reason?: string;
  } | null;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, REASON_MAX)
      : null;

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    // Indistinguishable from success — the room's existence is not
    // confirmed to strangers, exactly as /evict and /burn before it.
    return NextResponse.json({ ok: true });
  }

  await db.member.deleteMany({ where: { roomId } });
  await db.room.update({
    where: { id: roomId },
    data: {
      burned: true,
      burnedAt: new Date(),
      verifier: null,
      reportReason: reason,
    },
  });
  await notifyRelay(roomId);

  return NextResponse.json({ ok: true });
}
