# Security Policy

## Reporting a vulnerability

Email **lilice308@gmail.com** (the same address handles abuse reports;
prefix security mail with `SECURITY:` so it is triaged first). Please
include reproduction steps and, where relevant, the property or
invariant you believe is broken. This codebase's security contract is
written down (below) and every named property has a test you can point
at.

What we can offer:

- We target a first response within 7 days, and a clear timeline
  after that.
- Credit in `CHANGES.md` if you want it (the project's whole history is
  there, including the rounds where the agent was wrong and said so).
- No legal trouble for good-faith research against rooms you created
  yourself.

In scope: the crypto/protocol layer (`src/lib/`), the relay
(`mini-services/relay-service/`), the REST registry
(`src/app/api/`), and the graded report endpoint. Out of scope:
compromised devices (nothing in a browser survives that), traffic
analysis of the fact-and-volume kind (documented as out of scope in
`DESIGN.md` §6), and view-once as a UI promise (inherent to group
E2EE).

## The security contract, in one screen

- **Nothing readable is ever stored.** The server holds room
  lifecycle + a pubkey registry; messages exist only as live relayed
  ciphertext and in members' memory. No history, no metadata beyond
  room cards on your own device.
- **The canonical signing string is versioned and collision-proof.**
  `canonicalV2` signs eleven fields (the reply slot is conditional);
  field 11 is percent-escaped so the conditional 12th slot cannot be
  counterfeited by crafted content, as proven by a named test.
- **Key material has a CSPRNG-source proof.** The passphrase generator
  is byte-predictable under a deterministic stub and `Math.random` is
  spied to zero calls. (The `Math.random` substitution that once
  survived two review rounds is now a named regression test.)
- **Registry writes require proof-of-possession.** Leaving and
  member-reporting both demand an ECDSA signature from the member's
  registered room key (`cc-leave-v1` / `cc-report-v1`, domain-separated,
  ±10-minute windows).
- **Everything is replay-windowed and rate-limited**, per socket
  (token bucket) and per IP (per-route limiters).

## Abuse reporting: the graded mechanics

The architecture permits exactly **one act of moderation**: ending a
room. There is no content to review, no member to suspend, no history
to scrub. Round 31 shipped that act as an anonymous kill switch:
anyone holding a room ID (the weakest credential; it appears in every
forwarded invite link) could burn the room with one unauthenticated
POST. Round 32 graded it:

| Reporter | Mechanism | Effect |
|---|---|---|
| **A member** | Room settings → *Report this room*. The report is signed with the room's ECDSA key over `cc-report-v1:{roomId}:{memberId}:{ts}` and verified against the registered pubkey (active members only). | **Immediate burn**: registry destroyed, verifier withdrawn, every connected member told. |
| **A stranger** | Anonymous `POST /api/rooms/:roomId/report` (5/min/IP, uniform `{ok:true}` responses; existence and tally proximity are never confirmed). | **Queued, not burned.** Distinct reporting IPs are tallied in memory (web-tier restart resets it); **three distinct IPs** burn the room as the corroboration backstop. |
| **The operator** | `POST /terminate/:roomId` on the relay's token-guarded internal port. | Immediate burn, the legal path. |

The rule, stated in one line (`DESIGN.md` §6): **a member can end
the room at any time; a stranger needs corroboration.** Member burn was
already covered by the documented insider threat model (any member can
always sabotage a group E2EE room they are inside); what changed is
that the *weakest* credential no longer carries the *strongest* action.

## Dependency audit policy

Two gates (see `AUDIT.md`): the **runtime tree** is blocking with
per-advisory exceptions keyed by `(module, advisory id)`; the full tree
(dev/lint/build chains, none of which ship in the standalone image) is
advisory with per-advisory dispositions. `npm audit fix --force` is
forbidden: its "fix" for the prisma chain is a downgrade that silences
the dependency audit at the cost of real CLI fixes.

## Hardening round 2026-10 (full-codebase audit fixes)

A staff-level audit across architecture, memory/concurrency, security,
resilience, scalability and hygiene found the boundary layers around
the (sound) crypto core lacking. All findings below are fixed in this
round; each fix names its file so a reviewer can point at it.

1. **File viewer: HTML could execute same-origin.** A member-supplied
   file named `*.pdf` with mime `text/html` classified as a PDF, and
   the blob (typed `text/html`) rendered in the viewer's unsandboxed
   fallback `<iframe>` — same-origin script one message away from the
   localStorage creator tokens and the IndexedDB seed vault.
   `classifyFile` now normalizes the mime, sends HTML/xhtml to the
   escaped-source path *before* any extension check, and the blob's
   content type is chosen by category (forced `application/pdf` /
   `application/octet-stream`), never passed through raw.
   (`src/components/cc/file-viewer.tsx`)
2. **Relay `room:burn` was an unauthenticated kill switch.** Any socket
   could emit it for any room ID (public in every invite link) and
   terminate every member's live session; the REST `/burn` route's
   creator-token check was bypassed entirely. The relay now ignores
   client-emitted `room:burn`; the ONLY thing that emits `room:burned`
   is the token-guarded internal `/terminate/:roomId`, which the REST
   `/burn` and `/report` routes call after the registry burn.
   (`mini-services/relay-service/index.ts`, `src/lib/relay-admin.ts`)
3. **Rate limiting and report corroboration were spoofable via
   `X-Forwarded-For`.** Routes parsed the FIRST XFF hop, which an
   appending proxy (Caddy) preserves as client-controlled — every
   per-IP limit got a fresh budget per fake IP, and the anonymous
   report threshold ("three distinct IPs") collapsed to one attacker
   with three headers. `clientIp()` now takes the RIGHTMOST hop and is
   shared (one definition, seven call sites), and `IpRateLimiter`
   sweeps dead keys so the map cannot be grown without bound.
   (`src/lib/rate-limit.ts`, all `src/app/api/rooms/**` routes)
4. **The verifier PUT was unauthenticated and trusted bundle
   parameters.** Anyone with a room ID could win the seal race (the
   deliberate ≥1.7s sealing pause widens it) and lock the room under
   their own password, or store `m=8/t=1` argon2 params and cheapen
   every future offline guess. The PUT now requires the creator token,
   validates v2 bundles against shared bounds (`kdf-limits.ts`), and
   the client clamps bundle params on unlock as defense in depth.
   (`verifier/route.ts`, `src/lib/kdf-limits.ts`, `src/lib/kdf.ts`,
   `src/store/app.ts`)
5. **Relay re-join could rewrite a member's identity keys.** A join
   quoting an existing memberId overwrote that entry's
   pubkey/ECDH in the relay registry. Identity keys are now frozen at
   first join (alias refresh only); identity authority remains the
   REST registry, keyed by pubkey. (`mini-services/relay-service/index.ts`)
6. **`panicLock()` left legacy room keys behind.** PBKDF2 epoch keys
   for pre-v2 rooms are cached in a module map that the panic gesture
   never cleared — a "drop every key" chord that kept those rooms
   decryptable. `dropLegacyKeys` now runs in leave, burn, expiry and
   panic paths. (`src/lib/legacy.ts`, `src/store/app.ts`)
7. **Registry teardown was non-transactional and never swept.** Member
   write-out + epoch bump (and burn teardown) now commit in one
   `$transaction`; the janitor also sweeps burned rooms after a 7-day
   forensics window and rides the room-info read path (a quiet server
   never creates rooms, and used to never sweep).
   (`burn`, `evict`, `leave`, `report` routes; `src/lib/janitor.ts`)
8. **Resilience and hygiene.** Expired-room teardown now drops
   session/cipher/messages like leave and burn do (keys no longer
   linger for dead rooms); the unlock/join/create forms recover from
   transport errors instead of stranding on "Unlocking"; the replay
   guard's counter map is bounded like its id set; registry inputs
   (alias ≤ 64 chars, pubkey JSON ≤ 2 KB, `colorIdx` clamped on
   re-join as on join) are capped; the relay's internal token check
   refuses everything when unset and compares in constant time.

Known accepted residuals (unchanged): relay membership itself remains
unauthenticated (presence can be forged for a *known* memberId; frame
authenticity is unaffected — signatures and the REST registry gate
everything receivers act on); `creatorToken` is stored plaintext in
SQLite (operator threat model); `reactStrictMode` remains off pending
a dedicated pass to fix what double-invocation surfaces.
