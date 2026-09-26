import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import {
  verifyReportProof,
  tallyAnonymousReport,
} from "@/lib/report-proof";

// POST /api/rooms/:roomId/report. The abuse path, graded (Task 32).
//
// The architecture permits exactly one act of moderation: ending the
// room. There is no content to review (the server only forwards
// frames), no member to suspend (identity is per-room and derived), no
// history to scrub (none is stored). What this endpoint does is
// terminate the room by its ID. But Round 31 shipped that as an
// anonymous kill switch, and the acceptance review called the flaw
// correctly: the room ID is the WEAKEST credential in the system (it
// appears in every invite link), and handing it the strongest
// action meant anyone who ever saw a link could burn every room you
// create, at 5/min/IP, forever.
//
// Graded credibility (DESIGN.md §6):
//
//   member-signed  → immediate burn. A report carrying an ECDSA
//                    signature from a registered room key over
//                    cc-report-v1:{roomId}:{memberId}:{ts} is credible:
//                    members are the only humans who can see content,
//                    so they are the only credible content reporters,
//                    and member-initiated burn was already priced into
//                    the documented insider threat model.
//   anonymous      → queued, not burned. Distinct reporting IPs are
//                    tallied in memory; three burn the room as the
//                    backstop. One stranger with a grudge and a script
//                    is noise; three independent networks reporting the
//                    same room is corroboration.
//
// Uniformity: every non-rate-limited path answers exactly {ok:true}.
// Unknown rooms, already-burned rooms, inactive members, invalid or
// stale signatures, and both burn paths, all answer identically.
// Existence is never confirmed,
// and an anonymous reporter can never learn how close the tally is.
// Idempotent: burning is a one-way registry transition; replaying a
// captured (and still-in-window) member proof after the burn just hits
// the burned guard.

const reportLimiter = new IpRateLimiter({ limit: 5, windowMs: 60_000 });
const REASON_MAX = 500;

// roomId -> distinct reporting IPs (anonymous corroboration). In-memory
// by design: a web-tier restart resets the tally. This is an
// operator-visible
// tradeoff accepted because the member-signed path and the
// token-guarded relay /terminate are the primary abuse paths. The
// adjudication itself (window reset, distinct-IP counting, threshold)
// is the pure, unit-tested tallyAnonymousReport in report-proof.ts.
const anonymousReports = new Map<string, ReturnType<typeof tallyAnonymousReport>["next"]>();

const PRESENCE_URL_BASE = process.env.RELAY_PRESENCE_URL ?? "http://127.0.0.1:3004";
const PRESENCE_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/** Best-effort relay termination. The room is already dead in the
 * registry when this runs; a relay that cannot be reached leaves
 * connected members to discover it on their next poll. Never a
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

/** The one act this system can perform. Mirrors the burn route's
 * registry teardown so a reported room is indistinguishable, to its
 * members, from a creator's burn. */
async function burnRoom(roomId: string, reason: string): Promise<void> {
  await db.member.deleteMany({ where: { roomId } });
  await db.room.update({
    where: { id: roomId },
    data: {
      burned: true,
      burnedAt: new Date(),
      verifier: null,
      reportReason: reason.slice(0, REASON_MAX),
    },
  });
  anonymousReports.delete(roomId);
  await notifyRelay(roomId);
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
    memberId?: string;
    ts?: number;
    sig?: string;
  } | null;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, REASON_MAX)
      : null;

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    // Indistinguishable from success. The room's existence is not
    // confirmed to strangers, exactly as /evict and /burn before it.
    return NextResponse.json({ ok: true });
  }

  // ---- Member-signed path: proof of possession burns immediately ----
  if (
    typeof body?.memberId === "string" &&
    typeof body.ts === "number" &&
    typeof body.sig === "string"
  ) {
    // Active members only: a departed member has already rotated
    // themselves out (their leave bumped the epoch); their report
    // powers do not outlive their membership.
    const member = await db.member.findFirst({
      where: { id: body.memberId, roomId, active: true },
    });
    if (member) {
      let pubkey: unknown = null;
      try {
        pubkey = JSON.parse(member.pubkey);
      } catch {
        pubkey = null;
      }
      // A bad or stale proof is refused WITHOUT burning and answered
      // like success. A stranger who learned a memberId (a
      // server-issued handle, observable on the relay) must not be able
      // to burn with it, and must not learn why nothing burned.
      if (await verifyReportProof(pubkey, body.sig, roomId, body.memberId, body.ts)) {
        await burnRoom(roomId, `member:${reason ?? "(no reason given)"}`);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ---- Anonymous path: queue, don't burn (until corroboration) ----
  const { next, burn } = tallyAnonymousReport(
    anonymousReports.get(roomId),
    clientIp(request),
    Date.now(),
  );
  anonymousReports.set(roomId, next);
  if (burn) {
    await burnRoom(roomId, `corroborated:${next.ips.size} IPs${reason ? ` - ${reason}` : ""}`);
  }
  // Same {ok:true} as every other path. The tally is not an oracle.
  return NextResponse.json({ ok: true });
}
