// Short-lived socket tokens for the relay.
//
// The registry issues a signed token to each member who proves they
// know the room password. The client presents the token when joining
// a room on the relay, and the relay verifies it before binding the
// socket to the member id. This lets the relay confirm member
// identity without consulting the REST registry for every event.
//
// Token format: base64url(header).base64url(payload).base64url(sig)
//   header:  {alg: "HS256", typ: "JWT"}
//   payload: {roomId, memberId, exp, iat}
//   sig:     HMAC-SHA256 over header.payload, keyed by the relay
//            internal token (shared secret between registry and relay)
//
// Tokens expire after SOCKET_TOKEN_TTL_MS (5 minutes). A member who
// stays connected longer than that needs a fresh token before the
// relay will accept further events — but the relay only checks tokens
// on room:join, so a connected socket keeps working until it
// reconnects.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** How long a socket token is valid: 5 minutes. */
export const SOCKET_TOKEN_TTL_MS = 5 * 60_000;

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  // Restore padding and URL-safe chars.
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Convert a BufferSource (e.g. from crypto.subtle.sign) to Uint8Array. */
function toUint8Array(buffer: BufferSource): Uint8Array {
  return new Uint8Array(buffer as unknown as ArrayBuffer);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource);
  return toUint8Array(sig);
}

/** Create a short-lived socket token. */
export async function makeSocketToken(
  secret: string,
  roomId: string,
  memberId: string,
  ttlMs: number = SOCKET_TOKEN_TTL_MS,
): Promise<string> {
  const now = Date.now();
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { roomId, memberId, iat: now, exp: now + ttlMs };
  const headerB64 = base64UrlEncode(toUint8Array(encoder.encode(JSON.stringify(header))));
  const payloadB64 = base64UrlEncode(toUint8Array(encoder.encode(JSON.stringify(payload))));
  const signingInput = toUint8Array(encoder.encode(`${headerB64}.${payloadB64}`));
  const sig = await hmacSha256(toUint8Array(encoder.encode(secret)), signingInput);
  const sigB64 = base64UrlEncode(sig);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

/** Verify a socket token and return its payload, or null if invalid. */
export async function verifySocketToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): Promise<{ roomId: string; memberId: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = toUint8Array(encoder.encode(`${headerB64}.${payloadB64}`));
    const expected = await hmacSha256(toUint8Array(encoder.encode(secret)), signingInput);
    const expectedB64 = base64UrlEncode(expected);
    if (expectedB64 !== sigB64) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64)));
    if (
      typeof payload.roomId !== "string" ||
      typeof payload.memberId !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }
    if (now > payload.exp) return null;
    return { roomId: payload.roomId, memberId: payload.memberId };
  } catch {
    return null;
  }
}
