# Security Policy

## Reporting a vulnerability

Email **abuse@cipherchat.app** (the same address handles abuse reports;
prefix security mail with `SECURITY:` so it is triaged first). Please
include reproduction steps and, where relevant, the property or
invariant you believe is broken — this codebase's security contract is
written down (below) and every named property has a test you can point
at.

What we can offer:

- We target a first response within 7 days, and an honest timeline
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
  counterfeited by crafted content — proven by a named test.
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

## Abuse reporting — the graded mechanics

The architecture permits exactly **one act of moderation**: ending a
room. There is no content to review, no member to suspend, no history
to scrub. Round 31 shipped that act as an anonymous kill switch —
anyone holding a room ID (the weakest credential; it rides in every
forwarded invite link) could burn the room with one unauthenticated
POST. Round 32 graded it:

| Reporter | Mechanism | Effect |
|---|---|---|
| **A member** | Room settings → *Report this room*. The report is signed with the room's ECDSA key over `cc-report-v1:{roomId}:{memberId}:{ts}` and verified against the registered pubkey (active members only). | **Immediate burn** — registry destroyed, verifier withdrawn, every connected member told. |
| **A stranger** | Anonymous `POST /api/rooms/:roomId/report` (5/min/IP, uniform `{ok:true}` responses — existence and tally proximity are never confirmed). | **Queued, not burned.** Distinct reporting IPs are tallied in memory (web-tier restart resets it); **three distinct IPs** burn the room as the corroboration backstop. |
| **The operator** | `POST /terminate/:roomId` on the relay's token-guarded internal port. | Immediate burn — the legal path. |

The ceiling, stated in one line (`DESIGN.md` §6): **a member can end
the room at any time; a stranger needs corroboration.** Member burn was
already priced into the documented insider threat model (any member can
always sabotage a group E2EE room they are inside); what changed is
that the *weakest* credential no longer carries the *strongest* action.

## Dependency audit policy

Two gates (see `AUDIT.md`): the **runtime tree** is blocking with
per-advisory exceptions keyed by `(module, advisory id)`; the full tree
(dev/lint/build chains, none of which ship in the standalone image) is
advisory with per-advisory dispositions. `npm audit fix --force` is
forbidden — its "fix" for the prisma chain is a downgrade that buys
audit-quiet at the cost of real CLI fixes.
