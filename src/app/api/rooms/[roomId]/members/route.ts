import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROOM_MEMBER_CAP } from "../../route";

function isJwk(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).kty === "string" &&
    typeof (value as any).x === "string" &&
    typeof (value as any).y === "string"
  );
}

// POST /api/rooms/:roomId/members — join (or re-join after a refresh).
// Identity is the public key: same key = same alias, same color.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    pubkey?: unknown;
    alias?: unknown;
    colorIdx?: unknown;
  } | null;

  if (!isJwk(body?.pubkey) || typeof body?.alias !== "string" || typeof body?.colorIdx !== "number") {
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ error: "not-found", burned: !!room?.burned }, { status: 404 });
  }

  const pubkey = JSON.stringify(body.pubkey);
  const existing = await db.member.findUnique({
    where: { roomId_pubkey: { roomId, pubkey } },
  });

  if (existing) {
    const member = await db.member.update({
      where: { id: existing.id },
      data: { active: true, lastSeenAt: new Date(), alias: body.alias, colorIdx: body.colorIdx },
    });
    return NextResponse.json({
      memberId: member.id,
      epoch: room.epoch,
      rejoined: true,
    });
  }

  const activeCount = await db.member.count({ where: { roomId, active: true } });
  if (activeCount >= ROOM_MEMBER_CAP) {
    return NextResponse.json({ error: "room-full" }, { status: 403 });
  }

  const member = await db.member.create({
    data: {
      roomId,
      pubkey,
      alias: body.alias,
      colorIdx: Math.max(0, Math.min(7, body.colorIdx)),
      active: true,
    },
  });
  return NextResponse.json({ memberId: member.id, epoch: room.epoch, rejoined: false }, { status: 201 });
}

// GET /api/rooms/:roomId/members — the registry used by the key
// verification panel. Public keys only; the server cannot forge them.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
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
      joinedAt: m.joinedAt,
    })),
  });
}
