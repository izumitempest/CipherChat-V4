// The REST registry: the server's room lifecycle and member roster.
// This is the only authority for identity. The relay carries frames
// and presence; the registry says who is who.
//
// The slice covers: making a room, joining one, reading the roster,
// and changing the room's lifetime.

import { aliasFromFingerprint, inkFromFingerprint } from "@/lib/identity";
import { signMemberProof } from "@/lib/member-proof";
import { encodeJoinProof, makeJoinProof } from "@/lib/join-proof";
import { createKeyBundleV2, unlockWithBundle } from "@/lib/kdf";
import {
  loadRoomSettings,
  loadCreatorToken,
  saveCreatorToken,
  roomWatermarkStore,
  patchRoomCard,
  loadRoomCards,
} from "@/lib/local";
import { roomPersona } from "@/lib/room-persona";
import { ROOM_TTL_DEFAULT_SEC } from "@/lib/room-ttl";
import { RoomCipher, generateSessionEcdh } from "@/lib/room-protocol";
import { setCipher, getCipher } from "@/lib/room-protocol";
import { getRelay } from "@/lib/relay";
import { getSession, setSession, type RoomSession } from "@/lib/session";
import type { MemberPublic } from "@/lib/types";
import { addSystemLine } from "@/store/messages";
import { setResealing } from "@/store/desk";
import type { AppSlice } from "@/store/types";

export const FILE_LIMIT = 2 * 1024 * 1024; // 2 MB; nothing is stored anywhere

/** Same-origin registry API path for a room. The roomId is
 *  user-supplied (it arrives in the invite hash), so it is ALWAYS
 *  percent-encoded: a crafted id (`../`, `?`, `#`) must never steer
 *  the request path. */
export function roomApi(roomId: string, path = ""): string {
  return `/api/rooms/${encodeURIComponent(roomId)}${path}`;
}

/** The seal takes at least this long, on purpose: it is the vault
 *  moment, and a fast seal looks like a machine. */
export const MIN_SEAL_MS = 1700;

export const registrySlice: AppSlice = (set, get) => ({
  /* ----------------------------------------------- create ---- */

  createRoom: async (localName, password, ttlSec) => {
    const deriveIdentity = get().deriveIdentity;
    if (!deriveIdentity) return { ok: false, reason: "error" };

    let res: Response;
    try {
      res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttlSec: ttlSec ?? ROOM_TTL_DEFAULT_SEC }),
      });
    } catch {
      // The request never landed. No room was made.
      return { ok: false, reason: "error" };
    }
    // A server that says no is a server that said no. The old code
    // pushed on with whatever the body held, so a rate-limited
    // response left the client sealing a room that does not exist.
    if (!res.ok) return { ok: false, reason: "error" };
    const { roomId, creatorToken, expiresAt } = await res.json();
    saveCreatorToken(roomId, creatorToken);

    set({ sealing: { roomId, label: "Sealing the room" } });
    const started = Date.now();

    // This room's own signing identity + session ECDH pair, and the
    // argon2id key bundle (random salt, versioned, memory-hard). The
    // bundle comes with a join verifier: an HMAC over the derivation
    // output, bound to this room, which the server keeps and never
    // publishes. It is what tells a password holder from somebody
    // holding only the link.
    const [identity, ecdh, bundle] = await Promise.all([
      deriveIdentity(roomId),
      generateSessionEcdh(),
      createKeyBundleV2(password, roomId),
    ]);

    const [sealRes] = await Promise.all([
      fetch(roomApi(roomId, "/verifier"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Creator-token gated server-side: an unauthenticated first
        // write once let a stranger win the seal race (the deliberate
        // MIN_SEAL_MS pause widens the window) and lock the room under
        // a password of their own.
        body: JSON.stringify({
          verifier: JSON.stringify(bundle.bundle),
          creatorToken,
          joinProof: bundle.joinVerifier,
        }),
      }).catch(() => null),
      new Promise((r) => setTimeout(r, MIN_SEAL_MS - (Date.now() - started))),
    ]);
    // The seal has to land. A room with no verifier cannot be
    // unlocked by anybody, so a failed seal must not leave the creator
    // sitting in it.
    if (!sealRes || !sealRes.ok) {
      set({ sealing: null });
      return { ok: false, reason: "error" };
    }

    const alias = aliasFromFingerprint(identity.fingerprintHex);
    const colorIdx = inkFromFingerprint(identity.fingerprintHex);
    // The member proof: the registry update path writes a row that
    // already exists, so it asks for proof of the registered key. The
    // first join needs none, but signing costs one ECDSA operation
    // and keeps the two paths identical.
    const memberProof = await signMemberProof(
      identity.privKey,
      roomId,
      ecdh.pubRawB64,
    );
    const joinProof = encodeJoinProof(await makeJoinProof(bundle.joinVerifier, roomId));
    const joinRes = await fetch(roomApi(roomId, "/members"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: identity.pubJwk,
        ecdhPub: ecdh.pubRawB64,
        alias,
        colorIdx,
        proof: memberProof,
        joinProof,
      }),
    });
    if (!joinRes.ok) {
      set({ sealing: null });
      return { ok: false, reason: "error" };
    }
    const { memberId } = await joinRes.json();

    const cipher = new RoomCipher({
      roomId,
      selfId: memberId,
      sig: { priv: identity.privKey, pubJwk: identity.pubJwk },
      ecdh,
      entryKey: bundle.key,
      watermarks: roomWatermarkStore(roomId),
    });
    setCipher(roomId, cipher);

    const session: RoomSession = {
      roomId,
      memberId,
      alias,
      colorIdx,
      kv: 1,
      // Kept in the memory-only session: the invite sheet re-shares
      // it (masked, toggle to reveal) for as long as the room is open.
      password,
      creatorToken,
      expiresAt: expiresAt ? Date.parse(expiresAt) : undefined,
      defaultTtl: loadRoomSettings(roomId).defaultTtl,
      coverTraffic: loadRoomSettings(roomId).coverTraffic ?? false,
      legacy: false,
      joinVerifier: bundle.joinVerifier,
    };
    setSession(session);
    set({ sealing: null });
    await get().enterRoom(session, localName || "New room", false);
    return { ok: true };
  },

  /* ------------------------------------------------- join ---- */

  joinRoom: async (code, password, localName) => {
    const deriveIdentity = get().deriveIdentity;
    if (!deriveIdentity) return { ok: false, reason: "error" };

    let infoRes: Response;
    try {
      infoRes = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    } catch {
      // The request never landed. Nothing was joined.
      return { ok: false, reason: "error" };
    }
    if (!infoRes.ok) {
      const info = await infoRes.json().catch(() => ({}));
      return {
        ok: false,
        reason: info?.burned ? "burned" : info?.expired ? "expired" : "not-found",
      };
    }
    const info = await infoRes.json();
    if (info.memberCount >= info.memberCap) {
      return { ok: false, reason: "room-full" };
    }

    set({ sealing: { roomId: code, label: "Sealing the room" } });
    const started = Date.now();
    // The entry key (version 1): argon2id for new rooms, PBKDF2 for
    // rooms created before the upgrade. The bundle decides. The join
    // verifier comes with it: an HMAC over the same derivation output,
    // bound to this room, which proves to the server that the password
    // was right without sending the password or the key.
    const unlocked = await unlockWithBundle(password, info.verifier, code, info.epoch);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, MIN_SEAL_MS - (Date.now() - started))),
    );

    if (!unlocked) {
      set({ sealing: null });
      return { ok: false, reason: "wrong-password" };
    }

    const { key: entryKey, joinVerifier } = unlocked;

    const [identity, ecdh] = await Promise.all([
      deriveIdentity(code),
      generateSessionEcdh(),
    ]);
    const alias = aliasFromFingerprint(identity.fingerprintHex);
    const colorIdx = inkFromFingerprint(identity.fingerprintHex);
    const memberProof = await signMemberProof(
      identity.privKey,
      code,
      ecdh.pubRawB64,
    );
    const joinProof = encodeJoinProof(await makeJoinProof(joinVerifier, code));
    const joinRes = await fetch(roomApi(code, "/members"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: identity.pubJwk,
        ecdhPub: ecdh.pubRawB64,
        alias,
        colorIdx,
        proof: memberProof,
        joinProof,
      }),
    }).catch(() => null);
    if (!joinRes) {
      set({ sealing: null });
      return { ok: false, reason: "error" };
    }
    if (!joinRes.ok) {
      set({ sealing: null });
      if (joinRes.status === 403) {
        const err = (await joinRes.json().catch(() => null)) as { error?: string } | null;
        if (err?.error === "proof-required") return { ok: false, reason: "not-member" };
        if (err?.error === "join-proof-required") {
          return { ok: false, reason: "wrong-password" };
        }
        return { ok: false, reason: "room-full" };
      }
      return { ok: false, reason: "error" };
    }
    const { memberId, rejoined } = await joinRes.json();

    const cipher = new RoomCipher({
      roomId: code,
      selfId: memberId,
      sig: { priv: identity.privKey, pubJwk: identity.pubJwk },
      ecdh,
      entryKey,
      watermarks: roomWatermarkStore(code),
    });
    setCipher(code, cipher);

    // v1 rooms (versionless key bundles) keep the legacy receive path;
    // v2 rooms refuse v1 envelopes outright.
    let legacyRoom = true;
    try {
      legacyRoom = !info.verifier || JSON.parse(info.verifier)?.v !== 2;
    } catch {
      legacyRoom = true;
    }

    const session: RoomSession = {
      roomId: code,
      memberId,
      alias,
      colorIdx,
      kv: 1, // the current key arrives via ECDH offers if the room has rotated
      password,
      creatorToken: loadCreatorToken(code),
      expiresAt: info.expiresAt ? Date.parse(info.expiresAt) : undefined,
      defaultTtl: loadRoomSettings(code).defaultTtl,
      coverTraffic: loadRoomSettings(code).coverTraffic ?? false,
      legacy: legacyRoom,
      joinVerifier,
    };
    setSession(session);
    set({ sealing: null });
    const name =
      localName ||
      get().roomCards.find((c) => c.roomId === code)?.localName ||
      `Room ${code.slice(0, 4)}`;
    await get().enterRoom(session, name, !!rejoined);

    // A second window of this browser joined under its own persona:
    // say so, once, so the different nameplate is a explained thing
    // rather than a surprise.
    if (roomPersona(code) === "tab") {
      addSystemLine(
        set,
        code,
        "Second window of this browser: it speaks here under its own name.",
      );
    }

    // The server's epoch is the rotation LEDGER (it persists; keys do
    // not). If the room has rotated before and we are back at the
    // password-derived key (a rejoin after refresh, or a fresh join),
    // the current key must arrive via ECDH offers. Give live members a
    // moment to deliver; if nobody does (everyone refreshed), the
    // coordinator re-seals past the ledger so keys any departed member
    // may still hold are dead again.
    if (info.epoch > 1) {
      const attemptRotation = (minKv: number) => {
        const c = getCipher(code);
        const s = getSession(code);
        if (!c || !s || c.kv > 1) return;
        void c.rotateTo(minKv).then((offers) => {
          const relay2 = getRelay();
          for (const f of offers) {
            relay2.emit("message:send", { roomId: code, envelope: f });
          }
          addSystemLine(set, code, "The room re-sealed for those who remain.");
        });
      };
      setTimeout(() => {
        const cipher2 = getCipher(code);
        const session2 = getSession(code);
        if (!cipher2 || !session2 || cipher2.kv > 1) return;
        if (cipher2.expectedCoordinator() === session2.memberId) {
          attemptRotation(info.epoch);
        } else {
          // Ask the room for the current key; a live key-holder answers
          // with an ECDH offer.
          getRelay().emit("key:request", { roomId: code, from: session.memberId });
          setResealing(set, code, true);
          // Fallback: if nobody answers (every member refreshed, or the
          // holder is offline), re-seal on our own after a randomized
          // delay. The version is the server's epoch plus a fresh
          // random offset, so two members falling back at the same
          // time land on two different versions: the higher one wins
          // and the lower one takes it, instead of both installing a
          // different key under the same number.
          setTimeout(() => {
            const c = getCipher(code);
            const s = getSession(code);
            if (!c || !s || c.kv > 1) return;
            void c.rotateTo(info.epoch, false).then((offers) => {
              const relay2 = getRelay();
              for (const f of offers) {
                relay2.emit("message:send", { roomId: code, envelope: f });
              }
              addSystemLine(set, code, "The room re-sealed for those who remain.");
              setResealing(set, code, false);
            });
          }, 5000 + Math.floor(Math.random() * 3000));
        }
      }, 3000);
    }
    return { ok: true };
  },

  /* ------------------------------------------------ roster ---- */

  refreshMembers: async (roomId) => {
    try {
      // The roster is behind the join proof: a password holder, not a
      // link holder. See join-proof.ts.
      const session = getSession(roomId);
      const proof = session?.joinVerifier
        ? encodeJoinProof(await makeJoinProof(session.joinVerifier, roomId))
        : null;
      const res = await fetch(roomApi(roomId, "/members"), {
        headers: proof ? { "x-join-proof": proof } : undefined,
      });
      if (!res.ok) return;
      const { members } = (await res.json()) as { members: MemberPublic[] };
      set((s) => ({ members: { ...s.members, [roomId]: members } }));

      // Keep the cipher's registry in sync; it is the eviction gate.
      const cipher = getCipher(roomId);
      if (cipher) {
        const seen = new Set<string>();
        for (const m of members) {
          seen.add(m.memberId);
          const cur = cipher.registry.get(m.memberId);
          cipher.registry.set(m.memberId, {
            pubkey: m.pubkey,
            ecdhPubB64: m.ecdhPub ?? cur?.ecdhPubB64,
            connected: cur?.connected ?? true,
            joinedAt: m.joinedAt ?? cur?.joinedAt,
            alias: m.alias,
            colorIdx: m.colorIdx,
          });
        }
        for (const id of [...cipher.registry.keys()]) {
          if (!seen.has(id)) cipher.registry.delete(id);
        }
      }
    } catch {
      /* offline: the registry stays as-is */
    }
  },

  /* ------------------------------------------ room lifetime --- */

  adjustRoomTtl: async (roomId, ttlSec) => {
    const session = getSession(roomId);
    const token = session?.creatorToken ?? loadCreatorToken(roomId);
    if (!token) return { ok: false, reason: "not-creator" };
    try {
      const res = await fetch(roomApi(roomId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: token, ttlSec }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, reason: body?.error ?? "error" };
      }
      const { expiresAt } = await res.json();
      const ms = expiresAt ? Date.parse(expiresAt) : undefined;
      if (session) session.expiresAt = ms;
      patchRoomCard(roomId, { expiresAt: ms });
      set({ roomCards: loadRoomCards() });
      return { ok: true };
    } catch {
      return { ok: false, reason: "error" };
    }
  },
});
