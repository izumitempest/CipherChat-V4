// The application store. One Zustand store, assembled from slices.
//
//   lifecycle  — boot, routing, the desk (room cards)
//   registry   — the REST registry: create, join, roster, lifetime
//   sessions   — enter, leave, burn, panic, the room's teardown
//   transport  — the relay socket and everything that arrives on it
//   timers     — the clocks: burn, typing, cover traffic, rotation
//   messages   — the message memory and the file payload store
//
// The slices live in their own files under src/store/. They take the
// store's set and get as arguments, so none of them imports this
// file: the dependency graph is a tree, and the store is the root.
//
// SECURITY MODEL (protocol v3, see lib/protocol.ts + lib/room-protocol.ts):
//   Every frame the relay carries is padded to a uniform size and
//   encrypted; typing, receipts, burns, key offers and file chunks all
//   ride the same indistinguishable frames. Replay protection, the
//   member-registry eviction gate, signature checks and the ECDH key
//   rotation ceremony all live in RoomCipher; the store is a thin
//   adapter that turns OpenResults into UI.

import { create } from "zustand";
import { lifecycleSlice } from "@/store/lifecycle";
import { registrySlice } from "@/store/registry";
import { sessionsSlice } from "@/store/sessions";
import { transportSlice } from "@/store/transport";
import { messagesSlice } from "@/store/messages";
import type { AppState } from "@/store/types";

export type { AppState, JoinResult, SealingState, TypingSignal } from "@/store/types";
export { FILE_LIMIT } from "@/store/registry";

export const useApp = create<AppState>()(
  (set, get) =>
    ({
      ready: false,
      deriveIdentity: null,
      screen: "landing",
      activeRoomId: null,
      inviteCode: null,
      porchCreate: false,

      roomCards: [],
      messages: {},
      filePayloads: {},
      members: {},
      typing: {},
      relayOnline: false,
      resealing: {},
      sealing: null,
      burn: null,

      ...lifecycleSlice(set, get),
      ...registrySlice(set, get),
      ...sessionsSlice(set, get),
      ...transportSlice(set, get),
      ...messagesSlice(set, get),
      // The slices each own a part of the state, so the compiler cannot
      // see that the five of them cover the whole. They do: the tests
      // and the golden path call every action.
    }) as AppState,
);
