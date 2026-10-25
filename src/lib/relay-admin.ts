// Server-to-server room termination on the relay's internal port
// (3004, token-guarded, never routed through the gateway). Shared by
// the REST /burn and /report routes so that ANY registry-side burn
// reaches connected members immediately as "room:burned" — the event
// every client already runs its burn sequence on.
//
// This is the sanctioned termination channel. The relay no longer
// honors a client-emitted "room:burn" socket event at all: that event
// was unauthenticated, and the room id is the weakest credential in
// the system (it travels in every invite link).

const PRESENCE_URL_BASE = process.env.RELAY_PRESENCE_URL ?? "http://127.0.0.1:3004";
const PRESENCE_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

/** Best-effort relay termination. The room is already dead in the
 *  registry when this runs; a relay that cannot be reached leaves
 *  connected members to discover it on their next poll. Never a
 *  resurrection, never a caller failure. */
export async function terminateRoomOnRelay(roomId: string): Promise<void> {
  if (!PRESENCE_TOKEN) return; // fail closed: no token, no authority
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
