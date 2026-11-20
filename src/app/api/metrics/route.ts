import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/metrics. Simple Prometheus-style text exposition of basic
// operational counters. For a self-hosted product this is enough to
// scrape with a simple Prometheus config or read directly.
//
// Values are point-in-time reads from the database; they reset on
// restart (no persistent counter table). For trend analysis, scrape
// and store externally.
export async function GET() {
  const [roomCount, memberCount, burnedCount, expiredCount] =
    await Promise.all([
      db.room.count(),
      db.member.count(),
      db.room.count({ where: { burned: true } }),
      db.room.count({
        where: { expiresAt: { lt: new Date() }, burned: false },
      }),
    ]);

  const lines = [
    `# HELP cipherchat_rooms_total Total number of rooms in the registry.`,
    `# TYPE cipherchat_rooms_total gauge`,
    `cipherchat_rooms_total ${roomCount}`,
    ``,
    `# HELP cipherchat_members_total Total number of active member rows.`,
    `# TYPE cipherchat_members_total gauge`,
    `cipherchat_members_total ${memberCount}`,
    ``,
    `# HELP cipherchat_rooms_burned_total Total number of burned rooms.`,
    `# TYPE cipherchat_rooms_burned_total gauge`,
    `cipherchat_rooms_burned_total ${burnedCount}`,
    ``,
    `# HELP cipherchat_rooms_expired_total Total number of expired rooms not yet swept.`,
    `# TYPE cipherchat_rooms_expired_total gauge`,
    `cipherchat_rooms_expired_total ${expiredCount}`,
    ``,
  ];

  return new NextResponse(lines.join("\n"), {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
