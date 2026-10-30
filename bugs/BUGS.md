# CipherChat bugs

Everything wrong that I found, in one place. Line numbers are from the
state of the tree when I read it, so treat them as a map not a promise.

Severity is my opinion, not a standard. High means a member of the room
or a stranger with the link can make the product lie to someone. Medium
means it costs availability, trust, or a release claim. Low is hygiene.

---

## Protocol and crypto

### B1. the canonical form is not collision proof

`canonicalV2` in `src/lib/protocol.ts:311` glues fields together with a
pipe and only escapes `messageId`. `text` and `fileSha` go in raw, so a
message can borrow another message's signature.

```ts
const a = { kind: "text", text: "hello|world", fileSha: "" };
const b = { kind: "text", text: "hello", fileSha: "world|" };
```

both build `...|text|hello|world||`. a signature over one verifies for
the other. `README.md:75` calls this "canonical collision-proofing", so
the doc claims the opposite of what the code does.

The practical attack needs membership and a delivery race. a member
re-seals a colliding body under the room key and keeps the victim's
`sessionTag`, `counter`, `ts`, and `sig`. the replay guard only rejects
counters at or below the high water mark, so if the forged frame lands
first it is accepted and the real one gets dropped after. replay
protection was doing the work here, not the canonical form.

fix: length prefix the fields, or canonical JSON with sorted keys, or
escape every string field. then add a property test that hunts for
collisions across every variable length field, not just the reply
boundary.

### B2. most of the frame is not signed

`canonicalV2` covers `text`, the top level `fileSha`, `messageId`, and
the reply snapshot. it does not cover `ttlSec`, `typing`, the nested
`file` object, the chunk payload, or the contents of a key offer.

`sealFile` in `src/lib/room-protocol.ts:411` puts `name`, `mime`, `size`,
`ttlSec`, and `viewOnce` inside `body.file`, and none of that reaches
the canonical. the caption is signed, the attachment description is not.

so a member with the room key can re-seal a frame with a different file
name, a different view-once flag, or a different ttl, and the signature
still verifies. chunk bytes can be moved the same way. the sha check at
assembly only proves the bytes match the metadata that arrived with
them, it does not prove the sender authorised that metadata.

readme line 45 says the file meta frame is "canonical-signed like any
text message". that is true of the caption and false of the file.

fix: define the signed part per frame kind and sign all of it.

```ts
{ kind: "file:meta"; messageId; file: {name,mime,size,sha,ttlSec,viewOnce}; text; reply }
{ kind: "file:chunk"; messageId; seq; total; dataB64 }
{ kind: "text"; text; ttlSec?; reply? }
{ kind: "key:offer"; offer }
```

### B3. file chunks are not checked for shape

`src/lib/room-protocol.ts:701-709` only checks that `seq` and `total`
are numbers. nothing else.

- `seq` can be negative, fractional, or enormous
- `total` can be anything, so `chunks.size < total` never trips
- a chunk's `dataB64` has no length ceiling
- an accepted chunk can be replaced by a later frame
- nothing caps how many chunks one assembler keeps

The map of assemblers is capped at 32, but each assembler is not. one
member sends one meta with a huge `total` and a pile of frames with
unique sequence numbers and the chunk map grows until the tab dies.

fix: require `Number.isSafeInteger(seq)`, `seq >= 0`, `seq === FILE_TOTAL_CHUNKS`,
`total === FILE_TOTAL_CHUNKS`, a per chunk length, no second write to an
accepted slot, and a hard byte budget per file and per room.

### B4. two clients can rotate into the same version with different keys

`src/store/app.ts:759` falls back to
`rotateTo(info.epoch + 1 + Math.floor(Math.random() * 8), false)` when the
current key cannot be fetched. two clients can pick the same number and
make different keys. receivers only accept a version strictly greater
than what they hold, so both install cleanly and neither can read the
other afterwards.

fix: let the server hand out the epoch, or make the version a pair of
(epoch, random) that compares as one unit.

### B5. none of this is tested

182 tests pass and they cover the happy paths well. there is no test
that searches for a canonical collision, no test that flips `viewOnce`
and expects the signature to fail, no test that sends a chunk with
`seq = -1` or `total = 10 ** 9`, no test that runs two fallback
rotations against each other.

---

## Membership and access

### B6. updating a member needs no proof at all

`src/app/api/rooms/[roomId]/members/route.ts:76-96` finds the member by
public key, then sets `active: true`, overwrites `alias`, and overwrites
`ecdhPub`. no signature, no password, nothing.

public keys are readable from `GET /members`. so anyone holding a room
link can read a victim's key, post it back, and:
- reactivate that member
- take their alias
- swap the session ECDH key that key delivery is addressed to

the ecdh swap is the expensive one. rotation offers are wrapped pairwise
to the registered `ecdhPub`, so replacing it redirects the new room key.

fix: require a signature from that member's identity key before the
update. on its own this closes the alias spoof and the ecdh hijack,
because the attacker does not hold the victim's private key.

### B7. joining does not prove you know the password

same route, `create` branch. a new member is written with no proof of
anything beyond owning a public key. the registry can be filled by
people who never had the password, the coordinator can be chosen from
them, and a departed member comes back the moment their key is posted.

fix is the hard half of B6. a static verifier cannot do challenge
response, the server has no key to check a nonce against. doing this
properly wants a pake (opaque, srp style) or an operator held capability.
the signature half of B6 is the cheap win and should go first.

### B8. the roster is world readable

`GET /members` takes no credential. a link holder gets every alias,
public key, `ecdhPub`, `joinedAt`, and the room `epoch`. `GET /rooms/:id`
gives `memberCount` and `epoch` the same way.

readme hedges this as metadata, but a full membership timeline with join
times is a richer oracle than "who talks to whom".

fix: require proof of work or proof of password for the registry read,
or say plainly in the docs that link holders can see the roster.

### B9. the alias is whatever the client sends

the server stores `body.alias` up to 64 chars and serves it back.
`README.md` and `schema.prisma` both describe aliases as derived from key
fingerprints. the honest client derives it at `src/store/app.ts:564`, but
that is a client default, not a server property. until fingerprints are
checked by hand, alias impersonation inside a room costs nothing.

fix: derive the alias server side from the pubkey, or drop the claim.

### B10. leave and rejoin do not match the docs

`README.md:60` says the leaver never receives the rotated key. the e2e
test at `tests/e2e/golden-path.spec.ts:163` rejoins the leaver with the
same password and asserts the new key arrives.

the real behaviour is rotation excludes you while you stay out, and any
password holder walks back in with current access. that is a fine policy
for a permanent password, it just is not the sentence in the table.

This one is a doc problem more than a code problem. the code and the
test agree with each other, the readme disagrees with both.

fix: pick one sentence and put it in both places. if rejoin restores
access, say "is not sent the rotated key at rotation time" and stop
there.

---

## Server and availability

### B11. three strangers can burn any room

`src/app/api/rooms/[roomId]/report/route.ts` burns a room on three
distinct reporting ips. the ip is the rightmost xff hop, so a person
behind an appending proxy counts once per upstream, not once per
spoofed header, which is the right call. but the room id travels in
every invite link, and the room id is the only thing the anonymous path
asks for. one person with three cloud functions can end rooms forever.

the member signed path is fine and is the one that should carry this.
the anonymous backstop is what needs a cost attached.

fix: make the anonymous path pay something. a proof of work, a longer
corroboration window, a cap on how many anonymous terminations one room
can absorb before an operator sees it.

### B12. the tally forgets on restart

`anonymousReports` in the same file is a module level map. the web tier
restarts, the tally is gone, and the next three reports start from zero.
the comment admits this. it means the backstop resets exactly when it is
being tested hard, which is when restarts happen.

fix: move the tally to the database with a window, or accept it and
write it into SECURITY.md as a stated limit rather than a comment.

### B13. 500 chars of reporter free text, kept 7 days

`reportReason` is written from the request and kept for the whole
burned room retention window in `src/lib/janitor.ts`. not message
content, but not "nothing stored" either. a reporter can put anything in
it, including a link or a slur, and it sits in the db for a week.

fix: replace it with a reason code, or drop the field, or keep it and
name it in SECURITY.md as an operator forensics store.

### B14. no body size ceiling on the api

8 routes call `request.json()` with no byte limit on the request body.
field ceilings protect the database, they do not stop a 50 MB body
being parsed before anything looks at a field.

fix: one shared json body helper with a byte cap, used everywhere.

### B15. no security headers at all

`next.config.ts` has no `headers()` and there is nothing equivalent in
`deploy/Caddyfile`. no csp, no hsts, no nosniff, no referrer policy, no
permissions policy, no frame-ancestors, no coop.

a successful xss here hands over the creator tokens in localStorage, the
signing key in the vault, room keys in memory, and the decrypted
messages on screen. the file viewer is careful and there is no known xss
in the reviewed paths, which is exactly why csp should be the backstop
and not a later hardening task.

fix: strict csp with a reviewed `connect-src` for the relay, plus the
rest of the list, in the caddy config since that is what terminates tls.

### B16. relay cors allows every origin

`mini-services/relay-service/index.ts:44` is `cors: { origin: "*" }`.
same origin deployment does not need that, and a wildcard makes future
relay auth harder.

fix: pin the origin.

### B17. the relay counts frames, not bytes

the token bucket in `src/lib/rate-limit.ts` is 20 frames a second with a
burst. `maxHttpBufferSize` caps one frame at 1 MB. nothing accounts for
total bytes. a member sends 20 one-megabyte frames a second and there is
no ceiling on that at all.

frames are padded to a fixed size, which helps average sizing but does
nothing about sustained volume.

fix: add a byte bucket beside the frame bucket.

### B18. no migrations

there is no `prisma/migrations`. production uses `db push` and
`deploy/entrypoint-web.sh` only seeds when the db file is absent. an
existing volume never gets upgraded. the first schema change after
deploy breaks the running app.

fix: real migrations plus a versioned startup step and a backup story.
this blocks a production claim on its own.

### B19. rooms with no expiry are never swept

`src/lib/janitor.ts` deletes where `expiresAt: { lt: new Date() }`. a
null `expiresAt` is not less than anything in sqlite, so "until burned"
rooms accumulate forever. burned rooms do get swept, and expired ones
do, the third kind does not.

fix: sweep `expiresAt: null` rooms older than some limit, or delete them
when their creator token stops being used. state whichever rule you pick
where people can find it.

### B20. the creator token is plaintext and the comment says otherwise

`schema.prisma:27` keeps `creatorToken` as a raw string. every compare is
`body.creatorToken !== room.creatorToken`, in `burn`, `verifier`, and the
room patch route. not constant time either.

the actual risk is small, 24 random bytes is not worth guessing, and the
timing side channel is a non issue over the network. the problem is
`src/app/api/rooms/[roomId]/route.ts:52` comments that the token never
sits on the server beyond the hash-comparable original. it does sit
there, raw, and a db leak hands a burner for every room whose id is
public.

fix: hash it, or fix the comment. hashing is an hour.

---

## Client

### B21. room creation does not check the verifier write

`src/store/app.ts:548` fires the `PUT /verifier` inside a `Promise.all`
and never reads the response. if that write fails, the room goes on
looking created, the member joins, the seal animation plays, and no one
can ever open the room again.

fix: check the status before the join. if it failed, tear the room down
or refuse to finish the create.

### B22. burn does not check the server

`src/store/app.ts:1035` posts the burn and sets the local burn state
right after. a 500 gives you the ash animation, the key removal, the
burned room card, and a room that is still alive on the server.

fix: three states, request sent, server confirmed, connection failed.
only the middle one gets the full burn.

### B23. report does not check the server

same shape at `src/store/app.ts:1083`. uniform responses are a good idea
for report privacy, the client should not read them as confirmation.
wait for `room:burned` on the relay before showing the authoritative
burn.

### B24. the join sheet can hang forever

`src/components/screens/room-list.tsx` awaits `joinRoom()` with no
`try/catch`. the create and invite forms recover from a transport error,
this one does not, and the sheet stays busy until a reload.

fix: same catch as the other two forms.

### B25. the file viewer is not a real dialog

`src/components/cc/file-viewer.tsx:264` has `role="dialog"` and
`aria-modal="false"`. no focus move, no trap, no restore, no way back
that a keyboard user can find. you can tab behind the overlay into the
conversation.

fix: use the dialog primitive the project already has, or implement the
focus contract. if it is meant to be non modal, drop the `role` and say
so, and still give it a focus story.

### B26. the ttl countdown talks over the message log

the message container is `role="log" aria-live="polite"` and every ttl
message ticks once a second inside it. a screen reader likely re-reads a
changing number every second, per expiring message.

fix: `aria-live="off"` on the countdown, announce only at a minute and at
ten seconds, `aria-relevant="additions"` on the log.

### B27. the new password button is 17px

the design system says 44px minimum. this control is text sized.

fix: give it a 44px hit area even if the label stays small.

### B28. nothing virtualises

every message stays in zustand and every one of them is in the dom. a
long lived room grows without bound, and file payloads ride inside the
message array.

fix: virtualise, move payloads out of the message list, cap retained
plaintext.

### B29. the store is one file with everything in it

`src/store/app.ts` is about 2100 lines and owns room lifecycle, relay
wiring, rotation, timers, file transfer, notification choices, local
persistence, burn choreography, and ui state. `RoomCipher` is a decent
split, the thing around it is not.

fix: registry, sessions, transport, lifecycle, timers. do it after the
protocol work, not before.

### B30. strict mode is off

`reactStrictMode: false` in `next.config.ts:13`. in an app full of
sockets, timers and async effects that choice hides double mount bugs
during development.

fix: turn it on and pay the cost once.

### B31. verification fingerprints are 32 bits

`groupFingerprint` in `src/lib/identity.ts:89` shows the first 8 hex
chars of the pubkey digest. 32 bits is low for something people are
asked to compare out loud over another channel.

fix: show more, or show a short authentication string built from the
key instead of a slice of it.

### B32. the relay trusts the member id the client types

`memberId` rides on socket events and the relay forwards it. a member
can claim another member's presence, typing, and leave. message
authenticity is signature bound so this is noise, but `member:leave`
being forwardsable by anyone means the silent departure grace can be
stalled by a third party.

fix: bind the socket to a member id the server issued, or verify the
departure the way `leave` already does with a signature.

### B33. every file costs about 5 MB

`FILE_PAYLOAD_B64` is 2,800,000 and every file is padded to it, split
into 44 chunk frames of 65536 bytes, each encrypted then base64'd again
for the wire. a 1 KB voice note is roughly 3 MB of ciphertext and nearer
5 MB once base64 and json escaping are counted, and it eats the whole
frame rate budget.

fix: buckets. 64 KB, 256 KB, 1 MB, 2 MB, pad to the bucket. separate
"hide the size" from "move the bytes" and let the user pick.

---

## Docs that say the wrong thing

### B34. the landing copy overclaims

`src/components/screens/landing.tsx:108` says messages are "destroyed on
schedule" and "Neither can anyone else". ttl is off by default, and room
members can read everything.

better: "Messages are encrypted in your browser. Set them to disappear
on a timer if you want. We can't read them."

### B35. readme 45 says the file meta is signed like text

covered in B2. it is not.

### B36. design 151 says no counts no badges

"Unread is a 6px forest dot: no counts, no badges, no streaks." the app
ships an unread count pill in `room-list.tsx:229` and a launcher badge in
`app.tsx:127`.

### B37. design 136 still argues from pbkdf2

the rationale section explains why pbkdf2 at 750,000 iterations was
chosen. new rooms are argon2id, pbkdf2 is legacy unlock only. line 162
says it correctly, line 136 does not.

### B38. the seed vault fallback comment is wrong

`src/lib/seed-vault.ts:26` says the fallback keeps the seed in memory
for the page load only. the fallback in `src/store/app.ts:414` calls
`loadDeviceSeed()`, which writes the raw 32 bytes to localStorage under
`cc.seed` when it is missing. on a browser with no IndexedDB the seed
lands on disk in the clear.

`loadDeviceSeed` also carries a comment saying it exists only for tests.
it is a runtime path.

fix: make the fallback memory only to match the comment, or fix the
comment. memory only is the better of the two.

---

## Repo hygiene

### B39. bun is a runtime dependency

`package.json:57` has `"bun": "^1.4.2"`. that puts a
`node_modules/.bin/bun` ahead of the system bun inside package scripts,
which is why the documented
`cd mini-services/relay-service && bun run dev` dies with "Bun's
postinstall script was not run".

fix: delete it. bun is a tool you run, not a thing the app depends on.

### B40. dead dependencies

declared, imported nowhere, still inside the blocking audit scope:
`z-ai-web-dev-sdk`, `next-auth`, `@capacitor/*`, `@dnd-kit/*`,
`@tanstack/react-table`. `z-ai-web-dev-sdk` is a vendored sdk in a
privacy app and needs an explanation or a removal more than the rest.

also 35 of about 48 files in `src/components/ui/` are never imported.
tree shaking saves the bundle, it does not save the reviewer.

`AUDIT.md` says to delete unused deps rather than bump them. the project
does not follow its own rule.

### B41. .mimosa is committed

22 files from the ai review tool are tracked, including per session
uuid hook state and task review ledgers. same category as committing
`.claude/` or `.vscode/`.

fix: `git rm -r --cached .mimosa` and ignore it.

### B42. two dev launchers

`scripts/dev.sh` and `start-dev.sh` do overlapping jobs with different
behaviour. nobody can tell which one is the supported path.

fix: pick one, leave a note in the other.

### B43. the audit spans two lockfiles

`bun.lock` is current, `package-lock.json` is stale, the gate
materialises a fresh npm lockfile at run time and then runs both audits.
the gate failing when npm cannot reach the network is the gate working,
that part is fine. the split itself is the fragile bit.

fix: one authoritative lockfile and one audit command.

### B44. lan phone testing probably does not work

`start-dev.sh --lan` serves the app and the relay over plain http on a
lan ip. subtlecrypto wants a secure context, and an arbitrary lan ip over
http is not reliably one. the first crypto call fails and the service
worker never installs.

fix: https for lan testing, the tunnel that already exists or a local
cert.

### B45. missing tests at the trust boundaries

the protocol primitives are tested well, the places where trust actually
changes hands are not:

- existing member update with no private key proof
- alias substitution, ecdh key replacement
- new member with no password proof
- large request bodies
- rate limit edges
- a member editing another member's message
- silent leaver rejoining and recovering access
- two fallback rotations at once
- malformed chunks
- server failure during create, burn, report
- keyboard only runs of the context menus and the file viewer
- screen reader behaviour on ttl messages

there is also no axe gate anywhere, though axe is available transitively.

---

## Fixes

ordered by what to do first. the first five change the wire format or the
server contract so they want their own branch, not a drive by.

1. ship protocol v3. length prefixed or canonical json signing, sign
   every behavioural field per frame kind, then collision and tamper
   property tests. (B1, B2, B5)
2. require a signature from the identity key for an existing member
   update. closes the alias spoof and the ecdh hijack on its own.
   (B6, B9)
3. bound chunk handling. integer seq, fixed total, per chunk and per
   file caps, no rewrite of an accepted chunk. (B3)
4. check server responses in create, burn, report, and catch transport
   errors in the join sheet. (B21, B22, B23, B24)
5. hash the creator token and fix the comment at
   `src/app/api/rooms/[roomId]/route.ts:52`. (B20)
6. rework the report backstop. proof of work or a cap with an operator
   alert, and say the in-memory reset out loud in SECURITY.md.
   (B11, B12, B13)
7. add a shared json body helper with a byte limit. (B14)
8. put csp and the rest of the headers in the caddy file. (B15)
9. pin relay cors, add a byte bucket. (B16, B17)
10. decide the rejoin sentence and write it in readme and tests both.
    (B10)
11. decide whether the registry read needs proof, and document the
    answer. (B8)
12. fix the landing copy, design 151, design 136, seed vault comment.
    (B34, B36, B37, B38)
13. real prisma migrations with a startup step. (B18)
14. sweep the null expiry rooms. (B19)
15. server allocated or comparable rotation versions. (B4)
16. file viewer focus contract, ttl aria-live off, 44px on new password.
    (B25, B26, B27)
17. delete bun, the dead deps, and untrack .mimosa. (B39, B40, B41)
18. pick one dev launcher. (B42)
19. one lockfile, one audit command. (B43)
20. https for lan testing. (B44)
21. virtualise, split the store, strict mode on, longer fingerprints,
    relay side member binding. (B28, B29, B30, B31, B32)
22. bucket the file padding. (B33)
23. negative api tests, adversarial e2e, axe gate. (B45)
