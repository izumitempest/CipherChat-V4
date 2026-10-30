// Server-to-server room termination on the relay's internal port
// (3004, token-guarded, never routed through the gateway). Called by
// the REST /burn route so a registry-side burn reaches connected
// members immediately as "room:burned" — the event every client
// already runs its burn sequence on.
//
// This is the sanctioned termination channel. The relay no longer
// honors a client-emitted "room:burn" socket event at all: that event
// was unauthenticated, and the room id is the weakest credential in
// the system (it travels in every invite link).

// The presence base URL is OPERATOR configuration (deploy/.env /
// compose: http://relay:3004), never request input. It is parsed and
// validated ONCE at module load — http(s) only — and every request is
// built from the parsed URL's origin, so no env typo or injected
// value can steer these server-to-server calls anywhere else.
function parsePresenceBase(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`RELAY_PRESENCE_URL must be http(s), got: ${url.protocol}`);
  }
  return url;
}

export const PRESENCE_BASE: URL = parsePresenceBase(
  process.env.RELAY_PRESENCE_URL ?? "http://127.0.0.1:3004",
);
const PRESENCE_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

/** Best-effort relay termination. The room is already dead in the
 *  registry when this runs; a relay that cannot be reached leaves
 *  connected members to discover it on their next poll. Never a
 *  resurrection, never a caller failure. */
export async function terminateRoomOnRelay(roomId: string): Promise<void> {
  if (!PRESENCE_TOKEN) return; // fail closed: no token, no authority
  try {
    await fetch(`${PRESENCE_BASE.origin}/terminate/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { "x-internal-token": PRESENCE_TOKEN },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
  } catch {
    // The registry burn already happened; the relay will catch up.
  }
}
