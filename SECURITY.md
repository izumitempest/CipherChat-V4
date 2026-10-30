# Security policy

## Reporting something

Mail **lilice308@gmail.com**. The same address takes abuse reports, so
put `SECURITY:` at the front of the subject and it gets picked up
first. Send repro steps if you have them, and if it is a protocol thing
say which property you think broke.

The contract is written down below and each named property has a test
behind it, so you can point at the test rather than argue.

What you get back:

- first reply inside 7 days, and a real timeline after that
- credit in `CHANGES.md` if you want it. the whole history is in there,
  including the rounds where the agent was wrong and said so
- no legal noise for good faith work against rooms you made yourself

In scope: the crypto and protocol layer (`src/lib/`), the relay
(`mini-services/relay-service/`), and the REST registry
(`src/app/api/`).

Out of scope: a compromised device, nothing in a browser survives that.
Traffic analysis of the fact and volume kind, same as DESIGN.md §6.
View-once as a UI promise, which is inherent to group e2ee.

## The contract, short version

- Nothing readable is ever stored. The server holds room lifecycle and
  a pubkey registry. Messages live as live ciphertext and in members'
  memory. No history, no metadata beyond the room cards on your own
  device.
- The signing string is versioned, and the current version signs the
  whole frame body. `canonicalV3FromBody` takes the body out of its own
  signature, serialises it with sorted keys, hashes it, and puts that
  hash under a length-prefixed room id. Every field a frame carries is
  inside the signature: the text, the ttl, the view-once flag, the file
  name and mime, the file bytes, the key offer contents, and anything a
  later version adds. Nothing has to be escaped, so nothing can be
  forgotten.
- v2 frames are refused, not verified. The old signing string joined
  fields with a pipe and escaped only one of them, so two different
  bodies could produce the same string. A v3 build drops v2 frames, a
  v2 build drops v3 frames, and neither side prints a rejection line
  for the other. The room just goes still.
- Key material has a CSPRNG proof. The passphrase generator is
  byte-predictable under a deterministic stub, and `Math.random` is
  spied to zero calls. There was a `Math.random` substitution that
  survived two review rounds once. There is a named regression test
  for it now.
- Registry writes need proof of possession. Leaving wants an ECDSA
  signature from the member's registered room key (`cc-leave-v1`, a
  ±10 minute window). Rewriting a member row wants one too
  (`cc-member-v1`, the room and the ECDH key being written inside the
  signature).
- Joining needs proof of the password. The server keeps a join
  verifier: an HMAC over the key derivation output, bound to the room,
  in a column it never publishes. The client proves knowledge by
  HMAC-ing a timestamp and a nonce with it, so every proof is fresh,
  expires in ten minutes, and a captured one cannot be replayed later.
  The password never leaves the client and the server still cannot
  derive the room key. The member roster is behind the same proof, so
  a link holder can no longer read the room's members or their ECDH
  keys.
- The alias and the ink are the server's derivation. They come from the
  member's public key, and what the client sends is ignored, so a
  member cannot wear another member's name.
- The creator token is stored hashed. sha256, domain separated,
  compared in constant time. A database dump does not hand out a
  working burn key.
- Everything is replay windowed and rate limited. Per socket there is a
  frame bucket and a byte bucket, per IP there are per route limiters.
  Every route body is capped at 64 KB.
- The relay speaks only for the member ids a socket claimed when it
  joined. A client cannot announce that somebody else left, or type
  under somebody else's name.

## How a room ends

There is no report endpoint. There is no report button. A room ends
one of three ways:

| Who | Mechanism | Effect |
|---|---|---|
| The clock | The creator picks a lifetime when the room is made, up to 30 days. | The room is refused and swept. Nothing is kept. |
| The creator | Burn this room, in room settings. The request carries the creator token. | Immediate burn. Registry gone, verifier withdrawn, every connected member told. |
| The operator | `POST /terminate/:roomId` on the relay's token guarded internal port. | Immediate burn. The legal path. |

Why there is no report: the server holds no content, so it has nothing
to review, no member to suspend and no history to scrub. Its only act
would be ending the room, and every path to that act was reachable by
anyone holding an invite link. Grading it did not fix that. The
member-signed report path looked safe because a report had to carry a
signature from a registered key, but registering took no proof of
anything, so a link holder could register and then burn. The feature
went rather than staying as a second way to do the one thing it could
do.

Mail the address above for anything a room itself cannot fix.

## What the edge sends

The app sends a Content-Security-Policy with a fresh nonce per
request, made in a middleware and handed to Next through the `x-nonce`
header, so the policy names the nonce instead of waving every inline
script through with `unsafe-inline`. With it: nosniff, no-referrer,
DENY framing, a permissions policy that closes the camera and the
microphone, cross-origin isolation, and HSTS in production. The static
files get the same headers from `next.config.ts`, and the Caddy edge
sets them too.

The relay answers only the app's origin, from
`RELAY_ALLOWED_ORIGINS`, with the local app and the deployed site as
the defaults. A page on any other site can no longer open a socket
into a room it knows the id of.

## Dependency audit policy

Two gates, details in `AUDIT.md`. The runtime tree is blocking, with
per advisory exceptions keyed by `(module, advisory id)`. The full
tree, the dev and lint and build chains that never ship in the
standalone image, is advisory.

`npm audit fix --force` is forbidden. Its fix for the prisma chain is a
downgrade, which silences the audit at the cost of real CLI fixes.

## Hardening round 2026-10

A full codebase audit found the crypto core sound and the layers around
it not. All of it is fixed in this round, each fix names its file.

1. File viewer, HTML could execute same origin. A member supplied file
   named `*.pdf` with mime `text/html` classified as a PDF, and the
   blob, typed `text/html`, rendered in the viewer's unsandboxed
   fallback `<iframe>`. Same origin script one message away from the
   localStorage creator tokens and the IndexedDB seed vault.
   `classifyFile` normalizes the mime now, sends HTML and xhtml to the
   escaped source path before any extension check, and the blob's
   content type is picked by category, forced to `application/pdf` or
   `application/octet-stream`, never passed through raw.
   (`src/components/cc/file-viewer.tsx`)
2. Relay `room:burn` was an unauthenticated kill switch. Any socket
   could emit it for any room id and end every live session, bypassing
   the REST burn route's creator token check entirely. The relay
   ignores client-emitted `room:burn` now. The only thing that emits
   `room:burned` is the token guarded internal `/terminate/:roomId`,
   which the REST burn route calls after the registry burn.
   (`mini-services/relay-service/index.ts`, `src/lib/relay-admin.ts`)
3. Rate limiting was spoofable through `X-Forwarded-For`. The routes
   read the first XFF hop, which Caddy preserves as client controlled,
   so every per IP limit got a fresh budget per fake IP.
   `clientIp()` takes the rightmost hop now, is shared, one definition
   and seven call sites, and `IpRateLimiter` sweeps dead keys so the
   map cannot grow forever.
   (`src/lib/rate-limit.ts`, all `src/app/api/rooms/**` routes)
4. The verifier PUT was unauthenticated and trusted the bundle
   parameters. Anyone with a room id could win the seal race, the
   deliberate 1.7s seal pause widens it, and lock the room under their
   own password, or store `m=8/t=1` argon2 params and cheapen every
   future offline guess. The PUT wants the creator token now, checks v2
   bundles against shared bounds, and the client clamps bundle params
   on unlock as defense in depth. (`verifier/route.ts`,
   `src/lib/kdf-limits.ts`, `src/lib/kdf.ts`, `src/store/app.ts`)
5. Relay re-join could rewrite a member's identity keys. A join quoting
   an existing memberId overwrote that entry's pubkey and ECDH in the
   relay registry. Identity keys freeze at first join now, alias
   refresh only, and identity authority stays with the REST registry,
   keyed by pubkey. (`mini-services/relay-service/index.ts`)
6. `panicLock()` left legacy room keys behind. PBKDF2 epoch keys for
   pre-v2 rooms sit in a module map the panic gesture never cleared, so
   the drop every key chord kept those rooms decryptable.
   `dropLegacyKeys` runs in leave, burn, expiry and panic now.
   (`src/lib/legacy.ts`, `src/store/app.ts`)
7. Registry teardown was not transactional and never swept. Member
   write out and epoch bump, and burn teardown, commit in one
   `$transaction` now. The janitor also sweeps burned rooms after a
   7-day forensics window, and it rides the room info read path, because
   a quiet server never creates rooms and used to never sweep.
   (`burn`, `evict`, `leave` routes, `src/lib/janitor.ts`)
8. Resilience and hygiene. Expired room teardown drops session, cipher
   and messages the way leave and burn do. The unlock, join and create
   forms recover from transport errors instead of stranding on their
   busy states. The replay guard's counter map is bounded the way its id
   set is. Registry inputs are capped, alias 64 chars, pubkey JSON 2 KB,
   `colorIdx` clamped on re-join as on join. The relay's internal token
   check refuses everything when unset and compares in constant time.

## Residuals we accept

Relay membership is still not proved by a signature. The relay binds a
socket to the member ids it claimed at join time, so a client cannot
speak as somebody else, but it cannot tell that the id it claimed was
real. The REST registry can, and the client re-confirms against it
before it trusts anything, so frame authenticity is unaffected.

The room member cap is a soft cap. A coordinated attacker with many IPs
can still fill a room with real members.

The public key bundle stays a known-plaintext oracle for offline
password guessing. That is the design: argon2id at 64 MiB is there to
make the guessing expensive, and the room is useless without the
password.

The creator token lives in localStorage on the creator's device, because
burning has to work after a refresh. The server stores only its hash.

The file's true size is inside the encrypted meta frame, but the number
of chunk frames says which size bucket the file is in. The buckets hide
the size inside a bucket, not exactly.

The client's memory is bounded, not the protocol's. A room keeps at
most 500 letters and 32MB of file bytes, and the document holds 60
letters at a time. The caps are local, so a client that ignores them
would still hold everything; the wire does not care. See bugs/BUGS.md
B28.
