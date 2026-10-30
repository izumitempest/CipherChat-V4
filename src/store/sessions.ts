// The room sessions: entering a room, leaving it, burning it, and
// the teardown that takes a room's keys, drafts and clocks with it.
//
// A session holds the room key (in the cipher), the password, and the
// member's identity. None of it survives a reload, a burn, or the
// panic gesture.

import { dropDraft } from "@/lib/drafts";
import { dropLegacyKeys } from "@/lib/legacy";
import {
  loadRoomCards,
  loadRoomSettings,
  patchRoomCard,
  removeRoomCard,
  saveRoomSettings,
} from "@/lib/local";
import { getRelay } from "@/lib/relay";
import { releaseRoomPersona } from "@/lib/room-persona";
import { dropCipher, getCipher } from "@/lib/room-protocol";
import { dropSession, getSession, sessionRoomIds } from "@/lib/session";
import { fmtTtlRemaining } from "@/lib/format";
import { addSystemLine, clearRoomPayloads } from "@/store/messages";
import { roomApi } from "@/store/registry";
import {
  cancelBurns,
  clearRoomGrace,
  startCoverFor,
  startRotationFor,
  stopCoverFor,
  stopRotationFor,
} from "@/store/timers";
import type { AppSlice } from "@/store/types";

/** Everything a room holds goes at once: the clocks, the keys, the
 *  drafts, the grace timers, the file bytes. */
function teardownRoom(roomId: string, messages: { id: string }[]): void {
  cancelBurns(roomId, messages);
  stopCoverFor(roomId);
  stopRotationFor(roomId);
  dropSession(roomId);
  dropCipher(roomId);
  // Legacy epoch keys are cached in a module map the session/cipher
  // teardown cannot see; the teardown must drop them too, or pre-v2
  // rooms stayed decryptable after the room was gone.
  dropLegacyKeys(roomId);
  releaseRoomPersona(roomId);
  clearRoomGrace(roomId);
  dropDraft(roomId);
}

export const sessionsSlice: AppSlice = (set, get) => ({
  /* ----------------------------------------------- enter ----- */

  enterRoom: async (session, localName, rejoined) => {
    const now = Date.now();
    patchRoomCard(session.roomId, {
      roomId: session.roomId,
      localName,
      createdAt: now,
      lastActivity: now,
      lastMembers: 1,
      unread: false,
      unreadCount: 0,
      burned: false,
      locked: false,
      expiresAt: session.expiresAt,
    });
    set({ roomCards: loadRoomCards() });

    // Fresh message memory: there is no backlog, ever.
    set((s) => ({
      messages: { ...s.messages, [session.roomId]: [] },
      filePayloads: clearRoomPayloads(s.filePayloads, session.roomId),
    }));

    // A room with a clock announces it once, on entry; everyone
    // deserves to know when the door closes.
    if (session.expiresAt && session.expiresAt > Date.now()) {
      addSystemLine(
        set,
        session.roomId,
        `This room closes in ${fmtTtlRemaining(session.expiresAt - Date.now())} - then it's gone for everyone.`,
      );
    }

    await get().refreshMembers(session.roomId);

    const cipher = getCipher(session.roomId);
    const relay = getRelay();
    relay.emit("room:join", {
      roomId: session.roomId,
      memberId: session.memberId,
      alias: session.alias,
      colorIdx: session.colorIdx,
      pubkey: cipher?.sigPubJwk,
      ecdhPub: cipher?.ecdh.pubRawB64,
      rejoined,
    });
    set({ relayOnline: relay.connected });

    // Cover traffic (round 33): the heartbeat starts only when the
    // room has one; a room entered with the setting off on this
    // device stays silent until the toggle flips in settings.
    if (session.coverTraffic) startCoverFor(session.roomId);
    startRotationFor(session.roomId, (roomId, text) => addSystemLine(set, roomId, text));

    get().navigate("chat", session.roomId);
  },

  /* ------------------------------------------------- burn ---- */

  burnRoom: async (roomId) => {
    const session = getSession(roomId);
    // No creator token: this device cannot burn the room. The server
    // would refuse anyway, so say so here.
    if (!session?.creatorToken) return { ok: false, reason: "refused" };
    try {
      // The REST burn is the authority: it tears the registry down in
      // one transaction, then tells the relay over the token-guarded
      // internal channel — the only path that emits "room:burned"
      // now. (We used to also emit an unauthenticated room:burn on
      // the socket; the relay ignores that event by design, and
      // members hear the burn through the server's terminate call.)
      const res = await fetch(roomApi(roomId, "/burn"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: session.creatorToken }),
      });
      // The server refused the burn (a wrong token, a gone room, a
      // network wall): the room is still alive. Say so instead of
      // showing a burn screen for a room nobody burned.
      if (!res.ok) {
        return { ok: false, reason: "refused" };
      }
    } catch {
      // The request never landed. The room is still alive.
      return { ok: false, reason: "no-answer" };
    }
    set({ burn: { roomId } });
    return { ok: true };
  },

  finishRoomBurn: (roomId) => {
    const messages = get().messages[roomId] ?? [];
    teardownRoom(roomId, messages);
    patchRoomCard(roomId, { burned: true, unread: false, lastActivity: Date.now() });
    set((s) => ({
      burn: null,
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: { ...s.messages, [roomId]: [] },
      filePayloads: clearRoomPayloads(s.filePayloads, roomId),
    }));
    get().navigate("rooms");
  },

  /* ------------------------------------------------- leave --- */

  leaveRoom: async (roomId) => {
    const session = getSession(roomId);
    if (session) {
      // Proof-of-possession: sign the departure with the room's signing
      // key so nobody can write us out (and rotate the room out from
      // under everyone) with just our memberId.
      const cipher = getCipher(roomId);
      if (cipher) {
        const proof = await cipher.signDepartureProof();
        try {
          await fetch(roomApi(roomId, "/leave"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ memberId: session.memberId, ts: proof.ts, sig: proof.sig }),
          });
        } catch {
          /* best effort: receivers rotate on the announce regardless */
        }
      }
      // No cipher (locked/refreshed tab): skip the REST call entirely;
      // the server now demands a proof we cannot make without the key.
      // The relay announce below still tells receivers, who handle a
      // keyless departure via the silent-eviction grace path.
      getRelay().emit("member:leave", {
        roomId,
        memberId: session.memberId,
        alias: session.alias,
      });
    }
    const messages = get().messages[roomId] ?? [];
    teardownRoom(roomId, messages);
    removeRoomCard(roomId);
    set((s) => ({
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: { ...s.messages, [roomId]: [] },
      filePayloads: clearRoomPayloads(s.filePayloads, roomId),
    }));
    get().navigate("rooms");
  },

  /* ---------------------------------------------- settings --- */

  panicLock: () => {
    // Local-only: no relay announce, no registry write. The other side
    // will read the silence as a departure on the existing grace path.
    const ids = sessionRoomIds();
    for (const roomId of ids) {
      const messages = get().messages[roomId] ?? [];
      teardownRoom(roomId, messages);
    }
    set((s) => ({
      roomCards: loadRoomCards(),
      activeRoomId: null,
      messages: Object.fromEntries(Object.keys(s.messages).map((id) => [id, []])),
      filePayloads: {},
      typing: {},
    }));
    get().navigate("rooms");
  },

  setDefaultTtl: (roomId, ttl) => {
    const session = getSession(roomId);
    if (session) session.defaultTtl = ttl;
    saveRoomSettings(roomId, {
      defaultTtl: ttl,
      coverTraffic: session?.coverTraffic ?? loadRoomSettings(roomId).coverTraffic ?? false,
    });
  },

  /** Toggle the per-room cover traffic flag (RoomSettings on this
   *  device; the wire does not expose it). Stopping or starting the
   *  heartbeat is the scheduler's job, keyed on this value. */
  setCoverTraffic: (roomId, on) => {
    const session = getSession(roomId);
    if (session) session.coverTraffic = on;
    saveRoomSettings(roomId, {
      defaultTtl: session?.defaultTtl ?? 0,
      coverTraffic: on,
    });
    if (on) startCoverFor(roomId);
    else stopCoverFor(roomId);
  },

  closeExpiredRoom: (roomId) => {
    // The desk remembers it as closed for this session, like ash.
    const messages = get().messages[roomId] ?? [];
    cancelBurns(roomId, messages);
    patchRoomCard(roomId, { closed: true, locked: true });
    stopCoverFor(roomId);
    stopRotationFor(roomId);
    // Tell the room we've gone (they'll each hit the closed door on
    // their own clock or their next re-entry attempt).
    const session = getSession(roomId);
    if (session) {
      getRelay().emit("member:leave", {
        roomId,
        memberId: session.memberId,
        alias: session.alias,
      });
    }
    // The room is dead: its keys, messages and timers leave with it,
    // exactly like a leave or a burn. (This teardown once kept the
    // session and cipher in memory — decrypted content stayed live and
    // the password stayed held for a room that can never be entered
    // again.)
    dropSession(roomId);
    dropCipher(roomId);
    dropLegacyKeys(roomId);
    releaseRoomPersona(roomId);
    clearRoomGrace(roomId);
    dropDraft(roomId);
    set((s) => ({
      roomCards: loadRoomCards(),
      activeRoomId: s.activeRoomId === roomId ? null : s.activeRoomId,
      screen: s.activeRoomId === roomId ? "rooms" : s.screen,
      messages: { ...s.messages, [roomId]: [] },
      filePayloads: clearRoomPayloads(s.filePayloads, roomId),
    }));
  },
});
