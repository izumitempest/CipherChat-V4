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
  locked: boolean; // true after refresh — derived, not stored
  burned: boolean;
}

export type TtlChoice = 0 | 300 | 3600 | 28800; // OFF · 5m · 1h · 8h

export const TTL_STEPS: { value: TtlChoice; label: string; short: string }[] = [
  { value: 0, label: "Off", short: "Off" },
  { value: 300, label: "5 minutes", short: "5m" },
  { value: 3600, label: "1 hour", short: "1h" },
  { value: 28800, label: "8 hours", short: "8h" },
];

export type Screen = "landing" | "invite" | "rooms" | "chat";
