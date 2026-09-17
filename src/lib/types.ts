// CipherChat — shared types. The wire format is deliberately minimal:
// the server relays opaque envelopes and can read none of them.

export interface WireEnvelope {
  id: string;
  roomId: string;
  epoch: number;
  senderId: string;
  ts: number;
  iv: string; // base64
  ct: string; // base64 — AES-GCM over Payload
  ttlSec?: number;
  viewOnce?: boolean;
  kind: "text" | "file";
}

export interface FilePayload {
  name: string;
  mime: string;
  size: number;
  sha: string; // sha-256 hex of the raw bytes
  dataB64: string;
}

export interface Payload {
  text: string;
  ts: number;
  senderId: string;
  sig: string; // base64 ECDSA signature over the canonical string
  kind: "text" | "file";
  file?: FilePayload;
}

export interface MemberPublic {
  memberId: string;
  alias: string;
  colorIdx: number;
  pubkey: JsonWebKey;
  /** session ECDH public key (raw b64) — used for pairwise key delivery */
  ecdhPub?: string;
  connected?: boolean;
  joinedAt?: number;
}

export type MessageStatus = "sending" | "sent" | "burning";

export interface MessageView {
  id: string;
  kind: "text" | "file" | "system";
  senderId?: string;
  senderAlias?: string;
  senderColor?: number;
  self?: boolean;
  status: MessageStatus;
  ts: number;
  text?: string;
  file?: {
    name: string;
    mime: string;
    size: number;
    dataB64?: string;
    url?: string;
  };
  ttlSec?: number;
  expiresAt?: number;
  viewOnce?: boolean;
  spent?: boolean;
  /** ink margin marks — mark glyph → memberIds of everyone who set it */
  marks?: Partial<Record<ReactionMark, string[]>>;
}

/* ---------------- ink reactions ---------------- */

/** The four quiet margin marks. These exact strings travel on the wire
 *  (inside the encrypted, signed body) and key the local view state —
 *  they are product vocabulary, not decoration. */
export const REACTION_MARKS = ["✓", "✦", "♥", "☾"] as const;
export type ReactionMark = (typeof REACTION_MARKS)[number];

export const REACTION_LABELS: Record<ReactionMark, string> = {
  "✓": "Acknowledged",
  "✦": "Noted",
  "♥": "Warmly received",
  "☾": "Later",
};

export function isReactionMark(s: string): s is ReactionMark {
  return (REACTION_MARKS as readonly string[]).includes(s);
}

export interface SystemLine extends MessageView {
  kind: "system";
  text: string;
}

export interface RoomCard {
  roomId: string;
  localName: string;
  createdAt: number;
  lastActivity: number;
  lastMembers: number;
  unread: boolean;
  /** letters that landed while the room was away (this device's
   *  memory of them is a number — content is never stored) */
  unreadCount?: number;
  locked: boolean; // true after refresh — derived, not stored
  burned: boolean;
  /** when the room's time runs out (ms epoch), chosen by its
   *  creator — undefined = no expiry, until burned */
  expiresAt?: number;
  /** true when the room's lifetime elapsed while it sat on this
   *  desk — shown for the session, swept on next load (like ash) */
  closed?: boolean;
}

/* ---------------- message self-destruct ---------------- */

/** Message lifetime in seconds. 0 = off. Presets cover the common
 *  choices; anything else is a custom value (5s – 24h, clamped
 *  where it is entered) — the wire carries the number as-is. */
export type TtlChoice = number;

/** The shortest lifetime a custom expiry may be set to. */
export const TTL_MIN_SEC = 5;
/** The longest — a day; letters that outlive that aren't letters. */
export const TTL_MAX_SEC = 86400;

export const TTL_STEPS: { value: TtlChoice; label: string; short: string }[] = [
  { value: 0, label: "Off", short: "Off" },
  { value: 15, label: "15 seconds", short: "15s" },
  { value: 30, label: "30 seconds", short: "30s" },
  { value: 60, label: "1 minute", short: "1m" },
  { value: 300, label: "5 minutes", short: "5m" },
  { value: 3600, label: "1 hour", short: "1h" },
  { value: 28800, label: "8 hours", short: "8h" },
];

/** True when the value is a lifetime the presets don't cover. */
export function isCustomTtl(v: number): boolean {
  return v !== 0 && !TTL_STEPS.some((s) => s.value === v);
}

/** Clamp a custom lifetime into the sanctioned range. */
export function clampTtl(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(TTL_MAX_SEC, Math.max(TTL_MIN_SEC, Math.round(v)));
}

export type Screen = "landing" | "invite" | "rooms" | "chat";
