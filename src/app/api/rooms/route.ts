import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Crockford base32, no I/L/O/U — codes that survive being read aloud
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function makeRoomId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const ROOM_MEMBER_CAP = 12;

// POST /api/rooms — create a room. The server never learns the password:
// the client derives the key locally and later stores only a verifier blob.
export async function POST() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = makeRoomId();
    const existing = await db.room.findUnique({ where: { id } });
    if (existing) continue;
    const room = await db.room.create({
      data: { id, creatorToken: makeToken(), epoch: 1 },
    });
    return NextResponse.json(
      { roomId: room.id, creatorToken: room.creatorToken, epoch: room.epoch },
      { status: 201 },
    );
  }
  return NextResponse.json({ error: "room-id-collision" }, { status: 500 });
}
