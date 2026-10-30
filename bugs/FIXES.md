# Fix log

One entry per fix, in the order they landed. The numbers are the ones in
`BUGS.md`, so a fix can be found from the bug it closes.

## 1. Protocol v3, the signing string covers the whole frame (B1, B2)

The bug. The signing string was built by joining fields with a pipe, and
one field out of twelve was escaped. Two different frames could produce
the same string. A member holding the room key could rewrite the text in
somebody else's message, or turn a plain message into a quote, and the
signature still passed. The ttl, the view-once flag, the file name and
mime, the chunk bytes and the key offer contents were never in the
string at all.

The fix. Protocol v3 signs the whole frame body. The signing string is
the version tag, the length-prefixed room id, and the SHA-256 of the
canonical body:

    "2:v3" + "<roomId bytes>:<roomId>" + "64:<body hash>"

The canonical body is the frame body with its own signature taken out,
serialised with sorted keys and undefined dropped. Nothing has to be
escaped, so nothing can be forgotten to escape. The sealer and the
verifier call the same function with the same body, `canonicalV3FromBody`,
so the two sides cannot drift apart. That drift is how the old bug got
in.

v2 frames are refused, not verified. A v3 build drops v2 frames, a v2
build drops v3 frames, and neither prints a rejection line. The room
goes still. This is a wire format break, so every client has to land at
once. The product is rc1, so that is cheap today and expensive later.

Changed: `src/lib/protocol.ts`, `src/lib/room-protocol.ts`,
`src/store/app.ts`, the tests that described the old canonical, and the
protocol sections of `DESIGN.md`, `SECURITY.md`, `RELEASE_NOTES.md` and
`COMPONENTS.md`.

The check. `src/lib/__tests__/protocol-v3.test.ts` re-encrypts a real
frame under the room key with one field changed and the sender's own
signature still attached, which is exactly what a member can do, and
asserts the receiver says no. It covers the old text and file sha
collision, the ttl, the view-once flag, the quote, the file metadata,
the chunk bytes and the key offer contents. 197 tests across 20 files
passed.

Still rough. The legacy v1 envelope path in `src/lib/crypto.ts` still
joins eight fields with a pipe and still escapes nothing. It only serves
pre-v2 rooms and it was left alone on purpose. A v3 room never touches
it.

## 2. The abuse report goes (B11, B12, B13, B23)

The bug. The report feature was a kill switch with paperwork. The server
holds no content, so it has nothing to review, no member to suspend and
no history to scrub. The one act moderation could take was ending a
room. The anonymous path burned a room after three distinct IPs, the
tally lived in memory so a web restart cleared it, and the server kept
the reporter's free text for seven days against the nothing-stored
promise. The member path signed the report with the room key, but
registering a room key took no proof of anything, so a link-holder could
register and then burn. The report also never checked the server's
answer, so a failed report still played the local burn.

The fix. The feature is gone. No route, no store action, no button, no
modal, no proof module, no database column. A room ends when its time
runs out, when the creator burns it, or when the operator terminates it.
The creator's burn button stays, it holds the creator token. The
token-guarded relay `POST /terminate/:roomId` stays, that is the legal
path. The contact address stays.

Why the feature went rather than being graded better. Grading it was
tried. The grade held the shape of moderation without the substance,
because the thing being graded was never content. It was a way to end
a room, and every way to end a room was reachable by anyone holding an
invite link.

Removed: `src/app/api/rooms/[roomId]/report/route.ts`,
`src/lib/report-proof.ts`, the `reportRoom` action in `src/store/app.ts`,
the Report this room row and its modal in
`src/components/cc/settings-sheet.tsx`, the `reportReason` column in
`prisma/schema.prisma`, the copy in
`src/components/cc/app-settings-sheet.tsx` and
`src/components/portfolio/stack.tsx`, and the report proof and tally
tests in `src/lib/__tests__/task-32-last-round.test.ts`.

Changed: `src/lib/room-protocol.ts`, `src/lib/janitor.ts`,
`src/lib/rate-limit.ts`, `src/lib/relay-admin.ts`,
`mini-services/relay-service/index.ts`, and the moderation sections of
`SECURITY.md`, `DESIGN.md`, `RELEASE_NOTES.md` and `COMPONENTS.md`.

The check. 184 tests across 20 files pass, down from 197, the thirteen
report tests went with the code they tested. tsc clean, lint 0 errors
and the same two warnings in the composer, the build succeeds, and both
Playwright specs pass in Brave.

Still rough. `README.md` still has the abuse section and it points at a
feature that is gone. The README was off limits for this pass, so it
waits. Existing database rows keep their `reportReason` text until the
next `prisma db push` drops the column, which the deploy entrypoint
runs on every start.

## 3. The member update asks for proof of possession (B6)

The bug. The member registry is writable by anyone who knows the room
id. The roster is public, so a stranger could read a member's pubkey
and post it back. The route found the member by pubkey and overwrote
the row: the alias, the ink index and the ECDH key. The ECDH key is
what a key offer is encrypted to, so overwriting it meant the next key
offer went to whoever posted last. The room key with it.

The fix. The update path carries a signature from the member's own
registered key, over `cc-member-v1:{roomId}:{ecdhPub}:{ts}`. The ECDH
key is inside the signature, so a captured proof cannot be replayed onto
the attacker's key, which is the whole prize. The join path writes a
new row, so it needs no proof. There is nobody to take over.

The window is a day, not the ten minutes the leave proof uses. A device
with a wrong clock must not lock its owner out of a room they are
already in. The long window costs almost nothing here, because the
proof names the ECDH key: a captured one can only write the member's
own old ECDH key back, which costs that member a stalled key offer
until they re-join.

New: `src/lib/member-proof.ts`,
`src/lib/__tests__/member-proof.test.ts`.

Changed: `src/app/api/rooms/[roomId]/members/route.ts`, the create and
join flows in `src/store/app.ts`, the join error copy in
`src/components/screens/invite.tsx`, `room-list.tsx` and `chat.tsx`, and
the registry sections of `DESIGN.md`, `SECURITY.md` and `COMPONENTS.md`.

The check. The unit suite covers the canonical string, a foreign key, a
replay onto another ECDH key, another room, a stale and a future
timestamp, the window boundary, malformed input, and the domain
separation from the leave proof. The route was checked by hand against
a running server: posting a member's pubkey back with no proof, with a
forged proof and without an ECDH key all answer 403 `proof-required`,
and the row keeps its alias, its ink index and its ECDH key. 194 tests
across 21 files pass, and both Playwright specs pass in Brave, including
the rejoin, which is the path that asks for the proof.

Still rough. Joining proves no knowledge of the password (B7), the
roster is world-readable to any link holder (B8), and the alias the
server stores is whatever the client sent (B9). A member whose private
key is gone cannot get back into its own room, which is the price of
the proof. The error copy says so in plain words.

## 4. The file assembler checks the chunk shape (B3)

The bug. A file arrives as one meta frame plus a fixed number of chunk
frames. The assembler took the sender's word for the shape: any total,
any seq, any payload. A member could name a total of a billion and
feed the assembler an unbounded number of distinct chunks for one
file, and it held every one of them. A memory ceiling with no ceiling.

The fix. The receiver checks the shape before it stores anything. The
total has to be the fixed 44 chunks, the seq an integer inside the
range, the payload non-empty and at most 64,000 characters. The meta
has to be sane too: the size inside the format's limit, a lowercase
sha, a name and a mime within bounds. The pending transfers share a
byte budget, 16MB of chunk strings. A chunk that does not fit drops the
oldest transfer, and a chunk that does not fit even on an empty budget
is refused.

New: `src/lib/__tests__/file-chunk-shape.test.ts`, and
`FILE_MAX_BYTES` in `protocol.ts`.

Changed: `src/lib/room-protocol.ts` (the checks, the budget, an
optional budget so the tests do not move sixteen megabytes),
`protocol.ts`, and the file sections of `DESIGN.md` and `COMPONENTS.md`.

The check. The tests seal malformed frames with a signature the
receiver accepts, so the shape checks are under test and not the
signature check in front of them. They cover a total that is not 44, a
seq that is negative, past the end, fractional or not a number, an
empty and an oversized payload, a chunk for a transfer nobody
announced, and a meta with a bad size, sha, name or mime. The budget
tests use a small ceiling: the fourth chunk drops the oldest transfer,
and a chunk that cannot fit at all is refused. 202 tests across 22
files pass, and both Playwright specs pass in Brave, the golden path
included, which moves a file through the whole transfer.

Still rough. The relay keeps no byte budget of its own, so the same
flood costs it memory before it costs the clients any (B17, B32). Every
file is padded to a fixed 2.8MB of base64, so a small file costs what a
large one costs.

## 5. A key version is a pair, not a counter (B4)

The bug. A key version used to be the next number above the one the
client held. Two members falling back at the same time could land on
the same number, install two different keys under it, and read nothing
of each other afterwards. A receiver only accepts a version strictly
greater than the one it holds, so the second offer was ignored and the
room split in two. The fallback made it likely: it jumped a random
number of versions, and two clients with different versions in hand
could land on the same one.

The fix. A version is a pair: the server's rotation epoch, and a fresh
random offset inside it. The pair compares as one number, so a version
from a later epoch always wins, and two rotations inside one epoch
land on two different numbers. The higher one wins, the lower one
takes it, and the room is one room again.

The offset is fresh per rotation and always clears the offset this
client already holds, so nobody installs a version below their own. A
client whose offset sits at the top of its epoch steps into the next
epoch instead of drawing again.

New: `src/lib/__tests__/rotation-version.test.ts`.

Changed: `protocol.ts` (`ROTATION_VERSION_SPAN`, `rotationVersion`,
`rotationEpochOf`), `room-protocol.ts` (the version policy, the cap
now counts epochs, an injectable offset for tests), `store/app.ts` (the
fallback passes the server's epoch instead of a random jump, the leave
ceremony reads the epoch from the registry), and the rotation sections
of `DESIGN.md` and `COMPONENTS.md`.

The check. The new tests cover the pair arithmetic, two members
rotating at the same epoch landing on different versions, the version
always clearing the one held, a later epoch always winning, the
server's epoch winning when it is ahead, a client at the top of its
epoch stepping into the next one, and two simultaneous rotations
converging on one key. The older rotation tests were rewritten to
assert the properties rather than exact version numbers. 209 tests
across 23 files pass, and both Playwright specs pass in Brave, the
golden path included, which leaves, rotates and rejoins.

Still rough. Two rotations in the same epoch that draw the same
32-bit offset would still collide. One in four billion. The clean way
out is the server handing out every version, which costs a round trip
in the middle of the rotation ceremony and a new signed endpoint. The
version numbers are large now, which nothing outside the protocol
cares about.

## 6. Joining proves you know the password (B7, B8, B9)

The bug. Three holes in the member registry, one fix.

1. Anyone holding the link could register a member row: a name of
   their choosing, an ink of their choosing, a seat in the roster.
2. The roster was world-readable: anybody with the link could read
   every member's public key, alias and ECDH key.
3. The server stored whatever alias and ink the client sent, so a
   member could wear another member's name.

The fix. The server holds a join verifier: an HMAC over the key
derivation output, bound to the room id, in a column it does not
publish. The client proves knowledge by HMAC-ing a timestamp and a
nonce with that verifier, so every proof is fresh, expires in ten
minutes, and a captured one cannot be replayed later. The join asks
for it and the roster fetch carries it in a header. The alias and the
ink are derived server-side from the public key, with the same function
the client uses, and what the client sends is ignored.

The password never leaves the client. The server still cannot derive
the room key: it never had the derivation output, and the verifier is
one-way.

New: `src/lib/join-proof.ts`, `src/lib/__tests__/join-proof.test.ts`.

Changed: `src/lib/kdf.ts`, `src/lib/crypto.ts` (the legacy key bits),
`prisma/schema.prisma` (the `joinProof` column),
`api/rooms/[roomId]/verifier/route.ts`,
`api/rooms/[roomId]/members/route.ts`, `src/store/app.ts`,
`src/lib/session.ts`.

The check. The unit tests cover the verifier being bound to the room, a
proof verifying, a proof made for another room, a proof made with
another verifier, a stale and a future timestamp, the window boundary,
two proofs never matching, nothing verifying without a stored
verifier, malformed input failing without throwing, and the wire form
round-tripping. The route was checked by hand against a running server:
a roster read with no proof, a join with no proof and a roster read
with a junk proof all answer 403. 223 tests across 24 files pass, and
both Playwright specs pass in Brave.

Still rough. Rooms sealed before this change have no verifier stored
and the server cannot invent one, so they keep the old rule: the link
holder can register and the roster is readable. The public bundle is
still an offline password oracle, which is the design. The room-full
cap is still a soft cap.

## 7. The creator token, the server's answers, the body cap, the headers (B20, B21, B22, B24, B14, B15, B16)

The bug.

1. The creator token sat in SQLite in the clear, and the comment in
   the room route claimed the server held only something
   hash-comparable. It was compared with `!==`.
2. Creating a room ignored a refused creation, sealing a room that did
   not exist. Sealing ignored a refused seal, leaving the creator in a
   room nobody could unlock. Burning ignored a refused burn and showed
   the burn screen for a room that was still alive.
3. Every route read its JSON body with request.json(), which buffers
   whatever arrives. No ceiling anywhere.
4. The app sent no security headers at all.
5. The relay answered every origin.

The fix.

1. The server stores sha256 of the token, domain separated, and
   compares it in constant time. The plain token goes to the creator
   once and stays on their device. Old rooms store the token plain;
   it still works and gets replaced by the hash on first use.
2. All three now stop at the refusal. The burn reports the refusal in
   the settings sheet instead of showing a burn screen for a room that
   is still alive, and the unlock sheet catches a thrown request
   instead of spinning forever.
3. One shared reader caps bodies at 64 KB, checks content-length first
   and counts the bytes as they arrive. A body over the cap answers
   413.
4. A middleware makes a nonce per request and hands it to Next, so the
   Content-Security-Policy can name the nonce instead of using
   'unsafe-inline' for scripts. With it: nosniff, no-referrer, DENY
   framing, a permissions policy, cross-origin isolation and HSTS in
   production. The static files get the same headers from
   next.config.ts, and the Caddy edge sets them too.
5. The relay answers only the app's origin, from
   RELAY_ALLOWED_ORIGINS, with the local app and the deployed site as
   defaults.

New: `src/lib/creator-token.ts`, `src/lib/api-body.ts`, `src/lib/csp.ts`,
`src/middleware.ts`, `src/lib/__tests__/creator-token.test.ts`.

The check. The unit tests cover the stored form not being the token,
the hash being stable and domain separated, the right token matching,
the wrong one not, a plain token from an older room still matching, and
the two stored forms being told apart. By hand against a running
server: a 200 KB body answers 413, the relay hands the allowed origin a
CORS header and a foreign origin none, and the security headers are on
the response with a fresh nonce. 231 tests across 25 files pass, tsc
is clean, and both Playwright specs pass in Brave.

Still rough. Styles still need 'unsafe-inline'. The relay's origin
list is a list, not a policy. The creator token is still in
localStorage, because burning has to work after a refresh.

## 8. The relay counts bytes, speaks for the member it holds, the janitor sweeps the clockless rooms (B17, B32, B19)

The bug.

1. The relay limited frames, not bytes. 20 frames a second with a
   128 KB frame cap was 2.5 MB a second out of one socket, with no
   ceiling on the total.
2. The relay took the member id from every event the client sent. A
   client could announce that somebody else had left, which moved a
   live member's presence clock, or type under somebody else's name.
3. The janitor deleted rooms whose clock had run out. A null expiry
   is not less than anything in SQLite, so "until burned" rooms stayed
   in the database forever.

The fix.

1. A byte bucket beside the frame bucket: 1 MB a second sustained, 8
   MB of burst, charged with each frame's own size. A whole file
   transfer fits in the burst.
2. The relay binds a socket to the member ids it claimed when it
   joined. Every later event speaks for the bound id, and the client's
   own id is ignored. A socket that never joined a room cannot push
   frames into it.
3. Clockless rooms are swept after a year, and only when every member
   row is inactive and nobody has been seen since. A room somebody is
   sitting in is left alone. The rule is in the room lifetime copy
   and in DESIGN.md.

New: `src/lib/relay-binding.ts`, `src/lib/__tests__/relay-binding.test.ts`.

Changed: `src/lib/rate-limit.ts`, `mini-services/relay-service/index.ts`,
`src/lib/janitor.ts`, `src/components/cc/settings-sheet.tsx`.

The check. The unit tests cover the byte bucket charging the frame's
own size, refusing a frame larger than the whole burst, refilling at
the byte rate and not draining on a refusal; and the socket membership
holding the first claim in a room, dropping it on leave, keeping rooms
independent. 240 tests across 26 files pass, tsc is clean, and both
Playwright specs pass in Brave against the changed relay.

Still rough. The byte bucket is per socket, so a member with many
sockets has many buckets. The relay still has no idea whether a
member id is real: that is the REST registry's job, and the client
re-confirms against it before it trusts anything.

## 9. The schema has migrations now (B18)

The bug. There was no `prisma/migrations`. Production created the
schema with `prisma db push` on every boot and never upgraded an
existing volume, so the first schema change after a deploy broke the
running app. The bug report called this a blocker for a production
claim on its own, and it was right.

The fix.

- `prisma/migrations/0_init` is the baseline, written with IF NOT
  EXISTS so it can run against a database the old push flow left
  behind.
- `prisma/migrations/1_join_proof` adds the join verifier column.
- A `migrate` stage in the web Dockerfile and a `migrate` service in
  the compose file. It runs once per deploy, before the web container
  starts, and the web container waits for it.
- The step backs the database up first (one backup, beside the file),
  baselines a database that has tables but no migration history, and
  applies what is pending.
- The web container no longer bakes a schema template and no longer
  carries the Prisma CLI.
- CI applies the migrations before the production build.

The check. On a fresh database, `prisma migrate deploy` applies both
migrations and the tables come out right. On a database built the old
way (the tables, no history), the migrate step backs it up, baselines
it, applies the pending migration and the join verifier column lands.
The local database is under migration control now and
`prisma migrate status` says the schema is up to date.

Still rough. There is no downgrade story: a bad migration is undone by
restoring the backup.

## 10. The file viewer is a real dialog, the countdown stops talking, the landing copy stops overclaiming (B25, B26, B27, B34, B38)

The bug.

1. The file viewer was a hand-rolled overlay with `role="dialog"` and
   `aria-modal="false"`: no focus move, no trap, no restore. A keyboard
   user could tab behind it into the conversation.
2. The message list is a live log, and every message with a TTL ticked
   once a second inside it, so a screen reader read the number again
   every second for every expiring message.
3. The "New password" button was 17px of text with a 17px hit area.
4. The landing copy said messages are "destroyed on schedule" and
   "Neither can anyone else". The timer is off by default, and the
   room's members can read everything.
5. The seed vault comment promised the fallback keeps the seed in
   memory for the page load only. The fallback wrote the raw 32 bytes
   to localStorage, so the device seed landed on disk in the clear on
   exactly the browsers least able to keep it safe.

The fix.

1. The file viewer uses the project's dialog primitive now: the focus
   moves in, stays in, comes back where it was, Escape closes it, and
   the backdrop is the viewer's own paper surface.
2. The log announces additions only, the ticking label is out of the
   live region, and the countdown says something twice: about a minute
   left, and ten seconds left.
3. The label stays small, the hit area is 44px.
4. The footer now says the messages are encrypted in the browser, you
   can set them to disappear on a timer if you want, and the server
   cannot read them. The page metadata says the same thing.
5. The fallback seed is memory only, and the comment is true.

Changed: `src/components/cc/file-viewer.tsx`,
`src/components/ui/dialog.tsx`, `src/components/cc/bubble.tsx`,
`src/components/screens/chat.tsx`, `src/components/screens/landing.tsx`,
`src/app/layout.tsx`, `src/lib/room-identity.ts`, `src/store/app.ts`,
`DESIGN.md`, `COMPONENTS.md`.

The check. 240 tests across 26 files pass, tsc is clean, lint is clean
apart from the two old warnings, and both Playwright specs pass in
Brave, including the file viewer path.

Still rough. The countdown still runs a timer for every expiring
message. The dialog primitive now takes an overlay class, which is one
more prop than it had.

## 11. The repo housekeeping (B39, B40, B41, B42, B43, B44, B30, B31)

The bug.

1. Bun was a runtime dependency, so `node_modules/.bin/bun` came ahead
   of the system bun inside package scripts.
2. `z-ai-web-dev-sdk`, `next-auth`, the Capacitor packages, the
   dnd-kit packages and `@tanstack/react-table` were declared and
   imported nowhere. Forty of the forty-eight files in
   `src/components/ui/` were never imported either.
3. Twenty-one `.mimosa/` files were tracked: hook state, ledgers, task
   review reports.
4. Two dev launchers did overlapping jobs with different behaviour.
5. The blocking audit gate carried two lockfiles: `bun.lock` for the
   findings, a materialized npm lockfile for the runtime/dev split.
6. `--lan` served the app and the relay over plain http on a LAN
   address. WebCrypto needs a secure context, so the first crypto call
   failed and the service worker never installed.
7. Strict mode was off.
8. The verification fingerprint was 32 bits, and people are asked to
   compare it out loud over another channel.

The fix.

1. Bun is gone from `dependencies`.
2. The dead packages are gone, and the forty unused UI components are
   deleted. Eight remain: button, context-menu, dialog, input,
   popover, sheet, sonner, toast.
3. `.mimosa/` is untracked and ignored.
4. `start-dev.sh` is the supported launcher. It applies the
   migrations, starts both services detached, waits for the ports and
   can put https tunnels in front. `scripts/dev.sh` forwards to it.
5. The gate walks `bun.lock` from the root workspace's production
   dependencies through the dependency edges. One lockfile, one audit
   command, no network in the loop. AUDIT.md has a new round for it.
6. `--lan` starts a quick tunnel for the app and one for the relay,
   both https, and writes the relay's tunnel URL into `.env` before
   the web server starts.
7. Strict mode is on.
8. The fingerprint is 16 hex, 64 bits, in four groups.

The check. 240 tests across 26 files pass, tsc is clean, lint is clean
apart from the two old warnings, and both Playwright specs pass in
Brave with strict mode on. The audit gate still passes with the same
one masked exception (deepmerge-ts) and now reports 400 runtime
modules, read from bun.lock alone.

Still rough. The tunnels are quick tunnels: every restart gives a new
hostname, and the old link dies. The unused UI components are gone
rather than kept for later, so a future sheet may need its primitives
written again.

## 12. The routes get tested (B45)

The bug. The protocol primitives were tested well. The places where
trust actually changes hands were not: the API routes, the store, the
components. The bug report listed the gaps: a member update with no
private key proof, alias substitution, an ECDH key replacement, a new
member with no password proof, large request bodies, rate limit edges,
a member editing another member's message, a silent leaver rejoining,
two fallback rotations at once, malformed chunks, server failure during
create and burn, keyboard only runs, and screen reader behaviour on
the TTL messages.

The fix. A route suite that runs against a real database, a throwaway
one in the temp folder, created by the migrations and thrown away
after. The routes are called the way Next calls them: a Request in, a
Response out.

Covered now: a new member with no password proof is refused, a join
whose proof was made for another room is refused, a join with a good
proof lands and the stored alias and ink are the server's derivation,
an ECDH key change with no proof of possession is refused and the row
keeps its old key, the same key with its proof refreshes the row, a
body over the cap is refused with 413, the roster is refused without
the join proof and answers with it, a burn with the wrong creator token
does not burn, and a burn with the right creator token does.

New: `src/lib/__tests__/route-trust.test.ts`.

The check. 249 tests across 27 files pass, tsc is clean, and the
production build succeeds with the middleware registered.

Still rough. The store, the components and the keyboard-only runs are
still untested. The report path is gone, so the report test in the
bug's list no longer has anything to test.

## 13. A small file costs a small amount of traffic (B33)

The bug. `FILE_PAYLOAD_B64` was 2,800,000 and every file was padded to
it and split into 44 chunk frames. A 1 KB voice note was roughly 3 MB
of ciphertext and nearer 5 MB once the base64 and the JSON escaping
were counted, and it ate the whole frame rate budget. The padding was
there to hide the file's size from the relay, and it did.

The fix. Files land in a size bucket: 64 KB, 256 KB, 1 MB, 2 MB. A
file is padded to the smallest bucket that holds it and split into that
bucket's chunks. The wire cost is a step function now, and a 1 KB note
travels in three frames instead of forty five.

The trade, stated: the frame count says which bucket the file is in,
so the relay learns the bucket, not the file's true size. The true
size stays inside the encrypted meta frame. The receiver accepts only
the buckets' chunk counts, so a sender cannot name an arbitrary total.

The largest allowed file is unchanged: 2 MB.

Changed: `src/lib/protocol.ts` (the buckets, the bucket lookup, the
chunk count, the accepted totals), `src/lib/room-protocol.ts` (the
sender and the receiver).

The check. The padding tests now assert that a 1 KB file and a 300 KB
file land in different buckets, that the frame count follows the
bucket, that every chunk frame in a file is the same uniform size,
and that the bucket's padded length is its own base64 length. The
chunk shape tests still refuse a total that is not a bucket's count.
250 tests across 27 files pass, and both Playwright specs pass in
Brave, including the file path end to end.

Still rough. The buckets hide the size inside a bucket, not exactly.
A file's true length is still in the meta frame, which is encrypted,
but the frame count is a signal.

## 14. The docs match the code (B36, B37, and the drift around them)

The bug. DESIGN.md said "no counts, no badges" while the room list
ships an unread count pill, and it argued for the room key from PBKDF2
at 750,000 iterations when new rooms use argon2id and PBKDF2 is the
legacy unlock path only. Elsewhere the security contract still said the
creator token was plaintext in SQLite, that joining proved no knowledge
of the password, that the relay counted frames rather than bytes and
trusted whatever member id the client typed, and that the tree had no
security headers at all. Every one of those was true when it was
written and false now.

The fix. The docs are rewritten to the code, not the other way round.
The security contract lists the join proof, the hashed token, the body
cap, the relay's CORS and byte bucket and the member binding. The
threat model says the file buckets and the headers. The component
inventory has the new modules, the middleware, the migrations and the
64-bit fingerprint. The release notes say what is open and what is not.

Two README bugs stay open on purpose: README.md is off limits for this
round (B10 and B35).

The check. The docs are read against the code, line by line, and the
files they name exist. Lint is clean and the executable bits on 37
tracked files are off.

Still rough. The docs drift again the moment the code moves. The
audit that keeps them honest is a reading, not a test.

One more thing the round nearly broke: the CORS pin would have refused
the optional onion stack. The browser's origin there is the onion
address, Tor generates that address on the first boot, and the relay
had no way to know it. The relay accepts onion origins by pattern, the
same way it accepts the QA preview origins, and `deploy/TOR.md` says
how to pin the list to exactly one address after the first boot.

## 15. The store is slices, the memory is bounded, the document is a window (B28, B29, B5)

### The store was one file (B29)

The bug. `src/store/app.ts` was about 2100 lines and owned room
lifecycle, relay wiring, rotation, timers, file transfer, notification
choices, local persistence, burn choreography and UI state. One file to
read, one file to break.

The fix. Slices, one per concern, in `src/store/`: `lifecycle.ts`
(boot, routing, the desk), `registry.ts` (the REST registry),
`sessions.ts` (the room's life), `transport.ts` (the relay socket and
the departure confirmation), `receive.ts` (the receive pipeline),
`messages.ts` (the message memory and the file payloads), plus
`timers.ts` (the clocks) and `desk.ts` (the room cards). The state
shape and the shared types moved to `src/store/types.ts`.

Each slice takes the store's `set` and `get` as arguments. None of them
imports the store, so the dependency graph is a tree and the store is
the root. The rules the slices share, the message cap, the payload
budget, the mark toggle, the burn choreography, live in
`src/store/messages.ts` as pure functions, which is what made them
testable.

The check. A wiring test walks the state and fails if a slice forgot an
action. 273 tests across 30 files pass, tsc clean, eslint clean, the
build succeeds, and both Playwright specs pass in Brave.

Still rough. The store is still one Zustand store, so a change in one
slice can still be felt in another. The split is about reading, not
about isolation.

### Nothing virtualised (B28)

The bug. Every message stayed in Zustand and every one of them was in
the document, and the file payloads rode inside the message array. A
long-lived room grew without bound.

The fix, three parts.

The payloads moved out. A message names its file; the bytes live in
their own map, keyed by the message id, under a 32MB budget per room.
The oldest file is dropped when the budget is reached, its card says the
contents are no longer here, and a letter that falls off the cap takes
its file with it.

The plaintext is capped. A room keeps at most 500 letters. The oldest
go when the cap is reached.

The document is a window. It holds 60 letters at a time. Scrolling back
to the top brings the older ones in, and the reader's place in the log
is kept when they arrive: the height before the window grows is
measured, and the scroll follows it. A jump to a quoted message widens
the window to reach the target instead of saying the message is gone.

The check. The rules are pure, so they are tested directly: the cap
keeps the newest and drops the oldest, the payload budget drops the
oldest file and never the one that just arrived, the budget is counted
per room, a letter that falls off the cap takes its file with it, and
the bubble is rendered on the server and read as markup (an image card
with no bytes says so; the countdown keeps the ticking number out of
the live region and speaks once). Both Playwright specs pass in Brave,
the golden path included the file transfer end to end.

Still rough. The window is sixty letters, not a measured layout: a
message much taller than the rest pushes the count off, so a room of
large images shows fewer than sixty. The scroll position is kept by
height, not by anchor, so a very tall message can still move the
reader a little.

### The trust boundaries still had no tests (B5)

The bug. The property suite covered the crypto well. The API routes
got their tests in the last round. The store and the components had
none.

The fix. The store's rules are tested as what they are, pure functions
over plain data. The store's wiring is tested, so a missing action is a
red test rather than a crash in a room. The components are rendered on
the server and read as markup: no browser, no effects, the rules a
reader would notice are the ones under test. The vitest include widened
from `src/lib/__tests__` to every `__tests__` under `src`.

The check. 21 new tests, 273 across 30 files.

Still rough. The component tests read markup, not behaviour. Clicking a
mark, opening the viewer, typing in the composer: that is the E2E
suite's job, and it covers the golden path and the three-member path.

## 16. The README tells the truth (B10, B35)

### The leaver and the rotated key (B10)

The bug. The README's rotation row said "The leaver never receives
it". The E2E has rejoined the leaver with the same password and
watched the new key arrive, and the DESIGN documents the same thing.
The code and the test agreed with each other; the README disagreed
with both.

The fix. The row now says what actually happens: the leaver is not
sent the new key at rotation time, and it is not derived from the
password. The rejoin row says the other half: a password holder who
comes back gets the current key like anyone else.

### The file meta and the signature (B35)

The bug. The captioned-files bullet said the caption is
"canonical-signed like any text message". Under protocol v2 that was
false, and the bug list noted it as covered by B2: the old signing
string covered some fields and not others.

The fix. The whole frame body is signed now, so the bullet says the
signature covers the caption, the file's name, its type, its size and
the ttl.

### The README around them

The heading said protocol v2, the uniformity row described a fixed
number of chunk frames (the size buckets came later), the
property-suite list still named the report grading (the feature is
gone), the metadata bullet said the relay cannot read file sizes
(the bucket is visible), the reporting section described a feature
that no longer exists, and the development section described a
launcher that now forwards to another one.

All of it now matches the code, checked line by line against it: the
protocol version, the buckets, the join proof row, the suite list,
the metadata limit, the three ways a room ends, `start-dev.sh` with
its tunnels, and the migrations in the deploy and CI sections.

The check. The README's claims were read against the code, not from
memory: `TTL_STEPS` and the ttl bounds in `src/lib/types.ts`, the
suite names in the test directories, the relay's `dev` script, the
CI workflow, the compose file.
