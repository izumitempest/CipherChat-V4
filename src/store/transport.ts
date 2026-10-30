// The transport: one relay socket, registered once, and everything
// that arrives on it.
//
// The relay is blind. It carries ciphertext, presence and the room
// map. Everything that means something — who a member is, whether a
// letter is authentic, whether a departure really happened — is
// settled here, against the REST registry or the room cipher.
//
// The relay's own events are suggestions. A member:left event does not
// evict anybody until the registry agrees.
//
// The receive pipeline, the part that turns a frame into a letter, is
// in receive.ts.

import { verifyCanonical } from "@/lib/crypto";
import { getRelay } from "@/lib/relay";
import { getCipher } from "@/lib/room-protocol";
import { getSession, sessionRoomIds } from "@/lib/session";
import { stillSilentAtExpiry } from "@/lib/silent-grace";
import { WIRE_VERSION, type WireFrame } from "@/lib/protocol";
import type { MemberPublic, WireEnvelope } from "@/lib/types";
import { addSystemLine, onMessageBurn, patchView } from "@/store/messages";
import { roomNameOf, setResealing, touchCard } from "@/store/desk";
import {
  cancelBurnTimer,
  cancelGraceTimer,
  clearAllGrace,
  clearRoomGrace,
  clearTyping,
  pruneTypingLater,
  startGraceTimer,
  typingThrottled,
} from "@/store/timers";
import { roomApi } from "@/store/registry";
import { receiveFrame, receiveLegacyEnvelope } from "@/store/receive";
import type { AppSlice, StoreGet, StoreSet } from "@/store/types";

/** The server's rotation ledger for a room: the epoch a new key
 *  version should sit in. Zero when the room cannot be reached, which
 *  leaves the version in this client's own range. */
async function fetchRoomEpoch(roomId: string): Promise<number> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
    if (!res.ok) return 0;
    const info = (await res.json().catch(() => null)) as { epoch?: unknown } | null;
    return typeof info?.epoch === "number" && Number.isFinite(info.epoch) ? info.epoch : 0;
  } catch {
    return 0;
  }
}

export const transportSlice: AppSlice = (set, get) => ({
  /* --------------------------------------------- typing ------- */

  emitTyping: (roomId) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher) return;
    if (typingThrottled(roomId)) return;
    // Typing rides the same uniform encrypted frames as everything
    // else; the relay cannot even tell WHEN someone is typing.
    void cipher.sealTyping().then((frames) => {
      const relay = getRelay();
      for (const f of frames) relay.emit("message:send", { roomId, envelope: f });
    });
  },
});

/** The shared body of every confirmed departure, clean leave or
 *  silent expiry alike. REST is the identity authority: the relay
 *  event only SUGGESTS the departure; the registry confirms it
 *  before anyone is evicted or any key rotates. */
async function confirmDeparture(
  set: StoreSet,
  get: StoreGet,
  roomId: string,
  memberId: string,
  alias: string,
  line: string,
): Promise<void> {
  const session = getSession(roomId);
  if (!session) return;

  await get().refreshMembers(roomId).catch(() => undefined);
  const stillMember = (get().members[roomId] ?? []).some(
    (m) => m.memberId === memberId,
  );
  clearTyping(set, roomId, memberId);
  cancelGraceTimer(roomId, memberId);
  if (stillMember) return; // forged or racy: the "leaver" is still registered

  // Evict the leaver everywhere.
  set((s) => ({
    members: {
      ...s.members,
      [roomId]: (s.members[roomId] ?? []).filter((m) => m.memberId !== memberId),
    },
  }));
  const cipher = getCipher(roomId);
  if (cipher) cipher.registry.delete(memberId);
  addSystemLine(set, roomId, line);

  // Those who stay re-seal the room: if this client is the
  // deterministic coordinator, generate a RANDOM new key and deliver
  // it pairwise over ECDH. The leaver never receives it: not through
  // the password, not through the wire.
  //
  // The new version sits in the server's rotation epoch, so it lands
  // in the same range as the versions the other members pick.
  if (cipher && cipher.expectedCoordinator() === session.memberId) {
    const offerFrames = await cipher.rotateAsCoordinator(await fetchRoomEpoch(roomId));
    for (const f of offerFrames) {
      getRelay().emit("message:send", { roomId, envelope: f });
    }
    addSystemLine(set, roomId, "The room re-sealed for those who remain.");
  }
}

async function fireSilentEviction(
  set: StoreSet,
  get: StoreGet,
  roomId: string,
  memberId: string,
): Promise<void> {
  const session = getSession(roomId);
  const cipher = getCipher(roomId);
  if (!session || !cipher || session.memberId === memberId) return;

  const member = (get().members[roomId] ?? []).find((m) => m.memberId === memberId);
  const registryEntry = cipher.registry.get(memberId);
  const okToAct = stillSilentAtExpiry({
    selfConnected: getRelay().connected,
    memberPresent: !!member && !!registryEntry,
    // The member's own connected STATE (false = quietly gone), not a
    // comparison result. The UI list and the cipher registry are kept
    // in sync by the same presence handler.
    memberConnected: member?.connected ?? registryEntry?.connected ?? true,
    isCoordinator: cipher.expectedCoordinator() === session.memberId,
  });
  if (!okToAct || !member) return;

  try {
    const res = await fetch(roomApi(roomId, "/evict"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId, callerId: session.memberId }),
    });
    if (!res.ok) return; // the server's facts disagreed; let it be

    // Announce to the room. Receivers REST-confirm before acting,
    // exactly as with member:left: the relay event carries no
    // authority of its own.
    getRelay().emit("member:expired", { roomId, memberId, alias: member.alias });
    // Our own emit does not echo back; run the confirmation locally.
    await confirmDeparture(set, get, roomId, memberId, member.alias, `${member.alias} drifted away.`);
  } catch {
    /* offline: the next unlock restarts the grace clock via room:state */
  }
}

/* ==================================================================
   Relay wiring: one socket, registered once, drives the whole house
   ================================================================== */

export function wireRelay(
  set: StoreSet,
  get: StoreGet,
): void {
  const relay = getRelay();

  relay.on("connect", () => {
    set({ relayOnline: true });
    for (const roomId of sessionRoomIds()) {
      const session = getSession(roomId);
      const cipher = getCipher(roomId);
      if (session && cipher) {
        relay.emit("room:join", {
          roomId,
          memberId: session.memberId,
          alias: session.alias,
          colorIdx: session.colorIdx,
          pubkey: cipher.sigPubJwk,
          ecdhPub: cipher.ecdh.pubRawB64,
          rejoined: true,
        });
      }
    }
  });

  relay.on("disconnect", () => {
    set({ relayOnline: false });
    // We cannot be the connection authority while offline ourselves;
    // the room:state after reconnect re-arms whatever still matters.
    clearAllGrace();
  });

  relay.on("room:state", ({ roomId, members }: { roomId: string; members: MemberPublic[] }) => {
    // The relay authenticates nothing: room:state only updates
    // PRESENCE. Identity (pubkeys, ECDH keys) comes exclusively from
    // the REST registry, which is keyed by pubkey and cannot be
    // poisoned by a forged join. (Adversarial review 19-10, finding 1.)
    //
    // The relay sees exactly who is live right now: registry members
    // absent from its list are OFFLINE (the away-dot after a
    // refresh), the starting point of the silent-departure grace.
    const liveIds = new Set(members.map((m) => m.memberId));
    set((s) => {
      const registry = s.members[roomId] ?? [];
      if (!registry.length) return {};
      return {
        members: {
          ...s.members,
          [roomId]: registry.map((m) => ({ ...m, connected: liveIds.has(m.memberId) })),
        },
      };
    });

    const cipher = getCipher(roomId);
    if (cipher) {
      for (const live of members) {
        const cur = cipher.registry.get(live.memberId);
        if (cur) cipher.registry.set(live.memberId, { ...cur, connected: true });
      }
      // Unknown members wait for the REST refresh that member:joined
      // triggers: a forged relay join never enters the registry.
      for (const [id, cur] of cipher.registry) {
        if (!liveIds.has(id)) {
          cipher.registry.set(id, { ...cur, connected: false });
          startGraceTimer(roomId, id, (r, m) => {
            void fireSilentEviction(set, get, r, m);
          });
        }
      }
    }
  });

  relay.on(
    "member:joined",
    async ({ roomId, member, rejoined }: { roomId: string; member: MemberPublic; rejoined?: boolean }) => {
      const session = getSession(roomId);
      if (!session) return;

      // The relay join broadcast carries NO authentication; key
      // material from it is never trusted. The REST registry (keyed by
      // pubkey, so a forged memberId cannot overwrite a real member)
      // is the only identity authority: refresh from it, then act on
      // what it confirms. (Adversarial review 19-10, finding 1.)
      await get().refreshMembers(roomId).catch(() => undefined);
      const confirmed = (get().members[roomId] ?? []).find(
        (m) => m.memberId === member.memberId,
      );
      if (!confirmed) {
        return; // forged or unconfirmed join: no registry entry, no key
      }

      set((s) => ({
        members: {
          ...s.members,
          [roomId]: (s.members[roomId] ?? []).map((m) =>
            m.memberId === confirmed.memberId ? { ...m, connected: true } : m,
          ),
        },
      }));

      const cipher = getCipher(roomId);
      if (cipher && confirmed.ecdhPub) {
        const cur = cipher.registry.get(confirmed.memberId);
        cipher.registry.set(confirmed.memberId, {
          pubkey: confirmed.pubkey,
          ecdhPubB64: confirmed.ecdhPub ?? cur?.ecdhPubB64,
          connected: true,
          joinedAt: confirmed.joinedAt ?? cur?.joinedAt,
          alias: confirmed.alias,
          colorIdx: confirmed.colorIdx,
        });
        // If the room has rotated past the password-derived key, hand
        // the newcomer the CURRENT key, ECDH-wrapped and sealed under
        // the entry key, so only a joiner who proved the password can
        // open it. Every member sends; the joiner keeps the highest.
        if (cipher.kv > 1 && confirmed.memberId !== session.memberId) {
          void cipher.deliverKeyTo(confirmed.memberId).then((frames) => {
            for (const f of frames) {
              relay.emit("message:send", { roomId, envelope: f });
            }
          });
        }
      }
      if (confirmed.memberId !== session.memberId) {
        addSystemLine(set, roomId, rejoined ? `${confirmed.alias} returned.` : `${confirmed.alias} joined.`);
        touchCard(set, roomId, get().activeRoomId !== roomId);
      }
      // A return within the grace window cancels any pending
      // silent-eviction clock for them.
      cancelGraceTimer(roomId, member.memberId);
    },
  );

  relay.on(
    "member:presence",
    ({ roomId, memberId, connected }: { roomId: string; memberId: string; connected: boolean }) => {
      set((s) => ({
        members: {
          ...s.members,
          [roomId]: (s.members[roomId] ?? []).map((m) =>
            m.memberId === memberId ? { ...m, connected } : m,
          ),
        },
      }));
      const cipher = getCipher(roomId);
      if (cipher) {
        const cur = cipher.registry.get(memberId);
        if (cur) cipher.registry.set(memberId, { ...cur, connected });
      }
      // Connected again: the grace clock for this member stops.
      // Quietly gone: it starts (never for ourselves: our own
      // disconnects are visible to us, not departures).
      if (connected) cancelGraceTimer(roomId, memberId);
      else {
        startGraceTimer(roomId, memberId, (r, m) => {
          void fireSilentEviction(set, get, r, m);
        });
      }
    },
  );

  relay.on(
    "member:left",
    async ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session) return;
      // The relay event is unauthenticated. confirmDeparture()
      // re-checks the REST registry before evicting or rotating, so a
      // forged member:left cannot force a rotation or evict a live
      // member. (Adversarial review 19-10, finding 2.)
      await confirmDeparture(set, get, roomId, memberId, alias, `${alias} left.`);
    },
  );

  // A silent leaver was written out server-side (the coordinator's
  // grace-expired eviction). Same rule as member:left: the relay
  // event suggests, the registry confirms.
  relay.on(
    "member:expired",
    async ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session) return;
      await confirmDeparture(set, get, roomId, memberId, alias, `${alias} drifted away.`);
    },
  );

  relay.on("message:ack", ({ id, roomId }: { id: string; roomId?: string }) => {
    const target = roomId ?? get().activeRoomId;
    if (!target) return;
    patchView(set, target, id, { status: "sent" });
  });

  // NOTE: the legacy `message:spent` relay event is intentionally NOT
  // handled anymore: it carried no authentication, so anyone who knew
  // the room id could spoil view-once files for everyone. v2 clients
  // spend via cipher-verified encrypted frames. (Review 19-10, finding 3.)

  // Legacy early-burn announces from pre-upgrade clients.
  relay.on(
    "message:burn",
    async ({
      roomId,
      messageId,
      senderId,
      sig,
    }: {
      roomId: string;
      messageId: string;
      senderId?: string;
      sig?: string;
    }) => {
      const session = getSession(roomId);
      if (!session || !senderId) return;
      const target = (get().messages[roomId] ?? []).find(
        (m) => m.id === messageId,
      );
      if (!target || target.kind === "system") return;

      const registry = get().members[roomId] ?? [];
      const author = registry.find((m) => m.memberId === senderId);
      const ok =
        !!author?.pubkey &&
        !!sig &&
        target.senderId === senderId &&
        (await verifyCanonical(author.pubkey, ["v1", "burn", roomId, senderId, messageId].join("|"), sig));
      if (!ok) {
        addSystemLine(
          set,
          roomId,
          `A burn request claiming to be from ${author?.alias ?? "an unknown member"} was rejected - signature invalid.`,
        );
        return;
      }
      cancelBurnTimer(messageId);
      onMessageBurn(set, roomId, messageId);
    },
  );

  relay.on("room:burned", ({ roomId }: { roomId: string }) => {
    const session = getSession(roomId);
    if (!session) return;
    clearRoomGrace(roomId);
    set({ burn: { roomId } });
  });

  relay.on(
    "message:new",
    async ({ roomId, envelope }: { roomId: string; envelope: WireFrame | WireEnvelope }) => {
      const session = getSession(roomId);
      if (!session || !envelope) return;

      if ((envelope as WireFrame).v === WIRE_VERSION) {
        await receiveFrame(set, get, roomId, envelope as WireFrame);
        return;
      }
      // A frame carrying a protocol version this build does not speak
      // is dropped, not decoded. v2's signing string cannot tell two
      // different bodies apart, so verifying v2 frames would keep that
      // hole open. An old tab and a new tab do not hear each other.
      if (typeof (envelope as WireFrame).v === "number") return;
      // v1 envelopes only decode in v1 rooms; a v2 room accepting
      // them would let any password-holder bypass replay defense,
      // uniform padding and the registry gate. (Review 19-10, finding 4.)
      if (!session.legacy) return;
      await receiveLegacyEnvelope(set, get, roomId, envelope as WireEnvelope);
    },
  );

  // Legacy typing whispers from pre-upgrade clients: display only,
  // and only for senders the REST registry actually knows.
  relay.on(
    "member:typing",
    ({ roomId, memberId, alias }: { roomId: string; memberId: string; alias: string }) => {
      const session = getSession(roomId);
      if (!session || memberId === session.memberId) return;
      const known = (get().members[roomId] ?? []).some(
        (m) => m.memberId === memberId,
      );
      if (!known) return;
      set((s) => {
        const list = (s.typing[roomId] ?? []).filter((t) => t.memberId !== memberId);
        return {
          typing: { ...s.typing, [roomId]: [...list, { memberId, alias, at: Date.now() }] },
        };
      });
      pruneTypingLater(set, roomId);
    },
  );

  // A member who is stuck on an old key version asks for delivery.
  // Answer with the current key, wrapped so only password-holders
  // can open it. (Relay rate-limits these.)
  relay.on("key:request", ({ roomId, from }: { roomId: string; from: string }) => {
    const session = getSession(roomId);
    const cipher = getCipher(roomId);
    if (!session || !cipher || cipher.kv <= 1) return;
    if (from === session.memberId) return;
    if (!cipher.registry.has(from)) return;
    void cipher.deliverKeyTo(from).then((frames) => {
      for (const f of frames) {
        relay.emit("message:send", { roomId, envelope: f });
      }
    });
  });
}
