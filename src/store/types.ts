// The shape of the application store, and the types the pieces
// share. Kept in its own file so every slice can name the state
// without importing the store itself: the slices are leaves under
// this one, and the store is assembled from them at the top.
//
// The store is one Zustand store split into slices:
//   lifecycle  — boot, routing, the desk (room cards)
//   registry   — the REST registry: create, join, roster, lifetime
//   sessions   — enter, leave, burn, panic, the room's teardown
//   transport  — the relay socket and everything that arrives on it
//   timers     — the clocks: burn, typing, cover traffic, rotation
//   messages   — the message memory and the file payload store
//
// SECURITY MODEL (protocol v3, see lib/protocol.ts + lib/room-protocol.ts):
//   Every frame the relay carries is padded to a uniform size and
//   encrypted; typing, receipts, burns, key offers and file chunks all
//   ride the same indistinguishable frames. Replay protection, the
//   member-registry eviction gate, signature checks and the ECDH key
//   rotation ceremony all live in RoomCipher; the store is a thin
//   adapter that turns OpenResults into UI.

import type { StoreApi } from "zustand";
import type {
  MessageView,
  RoomCard,
  Screen,
  TtlChoice,
  MemberPublic,
  FilePayload,
  ReplySnapshot,
} from "@/lib/types";
import type { RoomSigningSecrets } from "@/lib/room-identity";
import type { RoomSession } from "@/lib/session";

export interface SealingState {
  roomId: string;
  label: string;
}

export interface JoinResult {
  ok: boolean;
  reason?:
    | "wrong-password"
    | "not-found"
    | "burned"
    | "expired"
    | "room-full"
    | "not-member"
    | "error";
}

/** Someone is writing. Transient, expires by its own clock. */
export interface TypingSignal {
  memberId: string;
  alias: string;
  at: number;
}

export interface AppState {
  ready: boolean;
  /** The per-room signing-key deriver, captured once per page load.
   *  When the IndexedDB seed vault is available it closes over the
   *  non-extractable CryptoKey; otherwise (private mode, older
   *  browsers) it derives from an in-memory seed that dies with the
   *  tab, which is the same behavior localStorage private mode had.
   *  Raw seed bytes never sit in state. */
  deriveIdentity: ((roomId: string) => Promise<RoomSigningSecrets>) | null;
  screen: Screen;
  activeRoomId: string | null;
  inviteCode: string | null;
  /** The porch's hand-off: /?app=1&create=1#/new arrived,
   *  consumed (and cleaned from the URL) during init, so the
   *  landing can open the create form on its first render. */
  porchCreate: boolean;

  roomCards: RoomCard[];
  messages: Record<string, MessageView[]>;
  /** The file bytes, kept out of the message list. A message names
   *  its file; the bytes live here under the message id, under a
   *  per-room budget. The list stays light and the memory is bounded. */
  filePayloads: Record<string, { roomId: string; dataB64: string }>;
  members: Record<string, MemberPublic[]>;
  typing: Record<string, TypingSignal[]>;
  relayOnline: boolean;
  resealing: Record<string, boolean>;
  sealing: SealingState | null;
  burn: { roomId: string } | null;

  init: () => Promise<void>;
  navigate: (screen: Screen, roomId?: string | null) => void;
  syncHash: () => void;
  createRoom: (
    localName: string,
    password: string,
    ttlSec?: number,
  ) => Promise<JoinResult>;
  joinRoom: (code: string, password: string, localName?: string) => Promise<JoinResult>;
  enterRoom: (session: RoomSession, localName: string, rejoined: boolean) => Promise<void>;
  /** Creator-only: change the room's lifetime while it lives. */
  adjustRoomTtl: (roomId: string, ttlSec: number) => Promise<{ ok: boolean; reason?: string }>;
  /** The room's time ran out while we were in it: mark and step out. */
  closeExpiredRoom: (roomId: string) => void;
  sendMessage: (
    text: string,
    file?: Omit<FilePayload, "sha"> & { viewOnce?: boolean },
    ttlOverride?: TtlChoice,
    reply?: ReplySnapshot,
  ) => Promise<void>;
  emitTyping: (roomId: string) => void;
  spendViewOnce: (roomId: string, messageId: string) => void;
  reactToMessage: (roomId: string, messageId: string, mark: string) => void;
  burnMessage: (roomId: string, messageId: string) => Promise<void>;
  burnRoom: (roomId: string) => Promise<{ ok: boolean; reason?: "refused" | "no-answer" }>;
  finishRoomBurn: (roomId: string) => void;
  leaveRoom: (roomId: string) => Promise<void>;
  renameRoom: (roomId: string, name: string) => void;
  /** The panic gesture: drop every room's in-memory key, draft and
   *  cipher, then land on the desk. The room cards stay, locked; the
   *  wire state is untouched (same behavior as a full refresh, without
   *  losing the desk to a reload). Bound to a long key chord and a
   *  header button so a locked-out host needs one motion. */
  panicLock: () => void;
  setCoverTraffic: (roomId: string, on: boolean) => void;
  setDefaultTtl: (roomId: string, ttl: TtlChoice) => void;
  markVerified: (roomId: string, memberId: string, verified: boolean) => void;
  isVerified: (roomId: string, memberId: string) => boolean;
  refreshMembers: (roomId: string) => Promise<void>;
}

/** Zustand's own set and get, named so a slice can take them as
 *  arguments instead of importing the store (which would be a cycle). */
export type StoreSet = StoreApi<AppState>["setState"];
export type StoreGet = StoreApi<AppState>["getState"];

/** A slice: a bag of state and actions, built from the store's set
 *  and get. The store assembles them at the top. */
export type AppSlice = (set: StoreSet, get: StoreGet) => Partial<AppState>;
