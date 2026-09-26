import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  IpRateLimiter,
  MEMBER_FRESH_WINDOW_MS,
  MEMBER_JOIN_PER_MIN,
} from "@/lib/rate-limit";
import { decideAdmission } from "@/lib/admission";
import { roomExpired } from "@/lib/room-ttl";

// POST /api/rooms/:roomId/members. Join (or re-join after a refresh).
// Identity is the public key: same key = same alias, same color.
// Keys are PER-ROOM (derived from the device seed), so the registry
// cannot be correlated across rooms.
const joinLimiter = new IpRateLimiter({ limit: MEMBER_JOIN_PER_MIN, windowMs: 60_000 });

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

function isJwk(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).kty === "string" &&
    typeof (value as any).x === "string" &&
    typeof (value as any).y === "string"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!joinLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    pubkey?: unknown;
    ecdhPub?: unknown;
    alias?: unknown;
    colorIdx?: unknown;
  } | null;

  const ecdhPubOk =
    body?.ecdhPub === undefined ||
    (typeof body.ecdhPub === "string" && body.ecdhPub.length > 0 && body.ecdhPub.length <= 200);

  if (
    !isJwk(body?.pubkey) ||
    typeof body?.alias !== "string" ||
    typeof body?.colorIdx !== "number" ||
    !ecdhPubOk
  ) {
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ error: "not-found", burned: !!room?.burned }, { status: 404 });
  }
  if (roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "room-expired" }, { status: 404 });
  }

  const pubkey = JSON.stringify(body.pubkey);
  const existing = await db.member.findUnique({
    where: { roomId_pubkey: { roomId, pubkey } },
  });

  if (existing) {
    const member = await db.member.update({
      where: { id: existing.id },
      data: {
        active: true,
        lastSeenAt: new Date(),
        alias: body.alias,
        colorIdx: body.colorIdx,
        ...(typeof body.ecdhPub === "string" ? { ecdhPub: body.ecdhPub } : {}),
      },
    });
    return NextResponse.json({
      memberId: member.id,
      epoch: room.epoch,
      rejoined: true,
    });
  }

  // Cap trade-off, stated honestly: the cap is a freshness-windowed
  // SOFT cap. It counts only active members seen within
  // MEMBER_FRESH_WINDOW_MS, so it exists to stop a code-holder without
  // the password from permanently locking the room with throwaway
  // keys. A coordinated attacker with many IPs and keys can still
  // exceed it (presence noise, not a confidentiality issue, matching
  // the Task 19 acceptance review's assessment).
  const recentlySeenCount = await db.member.count({
    where: {
      roomId,
      active: true,
      lastSeenAt: { gte: new Date(Date.now() - MEMBER_FRESH_WINDOW_MS) },
    },
  });
  const decision = decideAdmission({ recentlySeenCount });
  if (decision === "full") {
    return NextResponse.json({ error: "room-full" }, { status: 403 });
  }

  const member = await db.member.create({
    data: {
      roomId,
      pubkey,
      ...(typeof body.ecdhPub === "string" ? { ecdhPub: body.ecdhPub } : {}),
      alias: body.alias,
      colorIdx: Math.max(0, Math.min(7, body.colorIdx)),
      active: true,
    },
  });
  return NextResponse.json({ memberId: member.id, epoch: room.epoch, rejoined: false }, { status: 201 });
}

// GET /api/rooms/:roomId/members. The registry used by the key
// verification panel. Public keys only; the server cannot forge them.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const members = await db.member.findMany({
    where: { roomId, active: true },
    orderBy: { joinedAt: "asc" },
  });
  return NextResponse.json({
    members: members.map((m) => ({
      memberId: m.id,
      alias: m.alias,
      colorIdx: m.colorIdx,
      pubkey: JSON.parse(m.pubkey),
      ecdhPub: m.ecdhPub ?? undefined,
      joinedAt: m.joinedAt,
    })),
  });
}
