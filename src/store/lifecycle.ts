// The lifecycle: boot, routing, and the desk.
//
// Boot is one async call that sets up the identity deriver, reads the
// room cards, and wires the relay. Routing is the hash: the URL is
// the navigation, so a reload lands where the reader was.

import {
  loadRoomCards,
  loadVerified,
  patchRoomCard,
  saveVerified,
  sweepBurnedRooms,
} from "@/lib/local";
import {
  deriveRoomSigningKeyFromSeed,
  deriveRoomSigningKey,
  loadDeviceSeed,
  type RoomSigningSecrets,
} from "@/lib/room-identity";
import { acquireRoomPersona, personaInfoPrefix } from "@/lib/room-persona";
import { loadSeedKey } from "@/lib/seed-vault";
import { getSession } from "@/lib/session";
import type { Screen } from "@/lib/types";
import { wireRelay } from "@/store/transport";
import type { AppSlice } from "@/store/types";

// Set synchronously at the top of init(); see the comment there.
let initStarted = false;

export const lifecycleSlice: AppSlice = (set, get) => ({
  /* -------------------------------------------------- init ---- */

  init: async () => {
    // The synchronous flag matters: `ready` is only set after an
    // await, so two concurrent init() calls (a remount racing the
    // first mount) would BOTH pass the ready check and register every
    // relay handler twice. The flag has no await before it.
    if (initStarted || get().ready) return;
    initStarted = true;
    // One random seed per device; every room derives its own signing
    // key from it, so registries can never be correlated across rooms.
    // The seed lives in the IndexedDB vault as a non-extractable
    // CryptoKey when the browser supports it. When the vault is
    // unavailable (older browsers, some privacy modes), the legacy
    // localStorage loader keeps the old behavior as the fallback.
    const seedKey = await loadSeedKey();
    let deriveIdentity: (roomId: string) => Promise<RoomSigningSecrets>;
    if (seedKey) {
      // Room personas (Task 48): every window of this browser shares
      // the vault, so without this the second window of a room would
      // derive the SAME identity and silently rejoin as the first
      // window's member. The first window keeps the vault identity
      // (byte-identical, fingerprints survive); additional concurrent
      // windows derive under their own prefix and register as their
      // own members.
      deriveIdentity = async (roomId: string) => {
        const role = await acquireRoomPersona(roomId);
        return deriveRoomSigningKeyFromSeed(
          seedKey,
          roomId,
          role === "tab" ? personaInfoPrefix(roomId) : "cc-sig-v1",
        );
      };
    } else {
      const fallback = await loadDeviceSeed(); // memory only, no vault
      deriveIdentity = async (roomId: string) => {
        const role = await acquireRoomPersona(roomId);
        const legacy = await deriveRoomSigningKey(
          fallback,
          roomId,
          role === "tab" ? personaInfoPrefix(roomId) : "cc-sig-v1",
        );
        // The legacy path returns an extractable JWK; convert it to the
        // non-extractable CryptoKey the session is built on.
        const privKey = await crypto.subtle.importKey(
          "jwk",
          legacy.privJwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        );
        return {
          privKey,
          pubJwk: legacy.pubJwk,
          fingerprintHex: legacy.fingerprintHex,
          fingerprint: legacy.fingerprint,
        };
      };
    }
    // Burned rooms showed their ash last session; now they are gone.
    const cards = sweepBurnedRooms();

    // The porch's seal gesture ends here: /?app=1&create=1#/new
    // arrives expecting the create form already out. Read once,
    // here (client-side, post-hydration, beside the hash routing
    // it accompanies), and cleaned from the URL so a refresh
    // never re-opens the sheet at the user.
    const search = new URLSearchParams(window.location.search);
    const porchCreate = search.get("create") === "1";
    if (porchCreate) {
      search.delete("create");
      const qs = search.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          (qs ? `?${qs}` : "") +
          window.location.hash,
      );
    }

    set({ deriveIdentity, roomCards: cards, ready: true, porchCreate });

    get().syncHash();
    window.addEventListener("hashchange", () => get().syncHash());

    wireRelay(set, get);
  },

  syncHash: () => {
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (hash.startsWith("join")) {
      const code = hash.split("/")[1] ?? "";
      set({ screen: "invite", inviteCode: code || null, activeRoomId: null });
      return;
    }
    if (hash.startsWith("new")) {
      set({ screen: "landing", activeRoomId: null });
      return;
    }
    if (hash.startsWith("rooms")) {
      set({ screen: "rooms", activeRoomId: null });
      return;
    }
    if (hash.startsWith("r/")) {
      const roomId = hash.slice(2);
      const session = getSession(roomId);
      set({ screen: "chat", activeRoomId: roomId });
      if (session) {
        patchRoomCard(roomId, { unread: false, unreadCount: 0 });
        set({ roomCards: loadRoomCards() });
      }
      // No keys in memory: the room is locked. A first-class state,
      // never an error.
      return;
    }
    // Root: the desk if you have rooms, the landing if you don't.
    if (get().roomCards.length > 0) {
      set({ screen: "rooms", activeRoomId: null });
    } else {
      set({ screen: "landing", activeRoomId: null });
    }
  },

  navigate: (screen: Screen, roomId = null) => {
    const hash =
      screen === "rooms"
        ? "#/rooms"
        : screen === "chat" && roomId
          ? `#/r/${roomId}`
          : screen === "invite"
            ? "#/join"
            : screen === "landing"
              ? "#/new"
              : "#/";
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      get().syncHash();
    }
  },

  /* ---------------------------------------------- settings --- */

  renameRoom: (roomId, name) => {
    patchRoomCard(roomId, { localName: name });
    set({ roomCards: loadRoomCards() });
  },

  markVerified: (roomId, memberId, verified) => {
    const current = loadVerified(roomId);
    const next = verified
      ? Array.from(new Set([...current, memberId]))
      : current.filter((id) => id !== memberId);
    saveVerified(roomId, next);
    set((s) => ({ members: { ...s.members } })); // trigger re-render
  },

  isVerified: (roomId, memberId) => loadVerified(roomId).includes(memberId),
});
