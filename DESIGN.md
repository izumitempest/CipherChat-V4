# CipherChat, design documentation

Warm paper and deep forest.

---

## 1. Token sheet

### Color, "Daylight desk" (light, default)

| Token | Value | Usage |
|---|---|---|
| `--paper` | `#F4F1EB` | canvas |
| `--side` | `#EBE7DF` | raised surfaces, sidebar, cards, others' bubbles |
| `--charcoal` | `#2C2A28` | primary text |
| `--mute` | `rgba(44,42,40,0.6)` | secondary text, metadata, timestamps |
| `--wash` | `rgba(58,79,65,0.07)` | hover fill on low emphasis surfaces |
| `--forest` | `#3A4F41` | primary actions, secure states, identity accents |
| `--forest-deep` | `#2B3D31` | hover and pressed forest |
| `--terracotta` | `#C85A40` | destructive and impermanent only: burn, TTL, terminate, view-once |
| `--terracotta-deep` | `#A8492F` | hover and pressed terracotta |
| `--ember` | `#E8A87C` | burn glow edge, motion only, never static |
| `--ash` | `#B7B2A8` | burned room card state |
| `--hairline` | `rgba(44,42,40,0.08)` | 1px borders |
| `--ink-0` to `--ink-7` | 8 muted stationery inks | deterministic member identity, dot plus alias |

### Color, "Nightfall" (dark)

| Token | Value |
|---|---|
| `--paper` | `#17181A` |
| `--side` | `#212226` |
| `--charcoal` | `#F4F1EB` |
| `--mute` | `rgba(244,241,235,0.58)` |
| `--wash` | `rgba(116,148,128,0.09)` |
| `--forest` | `#4A6453` |
| `--forest-deep` | `#5B7A66` |
| `--terracotta` | `#E0745D` |
| `--terracotta-deep` | `#EA8A74` |
| `--ember` | `#EAB489` |
| `--ash` | `#6E6A63` |
| `--hairline` | `rgba(244,241,235,0.09)` |
| inks | lightened about 20% for contrast on dark paper |

Nightfall is not an inversion. Large surfaces stay muted and warm, only
text and accents are bright. All text clears 4.5:1.

### Type

| Role | Font | Size / line | Class |
|---|---|---|---|
| Display, landing and burn line | Lora 600 | 30/36 | `.t-display` |
| Screen title | Lora 600 | 20/28 | `.t-title` |
| Message body | Lora 400 | 15.5/1.5 | `.t-body` |
| UI labels and buttons | Inter 500 | 13 to 14, +0.01em | `.t-label` |
| Metadata and timestamps | Inter 400 | 11, +0.01em | `.t-meta` |
| Key fingerprints | IBM Plex Mono | 15, grouped `3F2A · 91BC`, select all | `.t-fingerprint` |

### Shape, space, materials

- 4pt spacing grid. Message stacks are 4px inside, 12px between sender
  groups. Consecutive messages within 3 minutes collapse timestamps,
  last of the group shows the time, and every TTL message also shows
  its own remaining life.
- Radii. 4 chips, 8 inputs, 12 buttons and cards, 18 bubbles, and the
  corner nearest the sender drops to 6.
- Touch targets 44px or more, primary buttons 48px.
- Materials. Cards are `side` plus a hairline, no shadow. Only the
  composer and dialogs blur and take `0 1px 2px @8%`. Paper grain is a
  2.5 to 3% noise overlay over the whole canvas, 5% soft-light in
  Nightfall.
- Bubbles max-width 75%. Self is right aligned on a forest wash, others
  are left aligned with an ink dot and alias.
- Layout. Mobile first single column. Desktop is a 320px desk sidebar
  plus a chat column capped at 720px and centered. PWA manifest and
  icons included.

---

## 2. Component inventory

| Component | States |
|---|---|
| **PrimaryAction** | default, hover (`forest-deep`), busy (spinner), disabled. 48px, radius 12. |
| **SecondaryAction** | default, hover (`wash`), busy, disabled |
| **DestructiveAction** | default, hover (deep), busy. Terracotta, burn contexts only. |
| **QuietAction** | default, hover, mute text going to charcoal |
| **Field / TextField / PasswordField** | default, focus (forest ring), error (neutral charcoal inline, errors never carry color), disabled |
| **MonoValue** | resting, copied |
| **RoomCard** | normal (paper lift on hover), locked (lock glyph, muted), unread (forest dot plus a count pill), **burned** (ash, low contrast strikethrough, kept one session then cleared) |
| **UnlockSheet** | default, wrong password, unlocking (goes to S3) |
| **MessageBubble** | sending (60% opacity), sent, grouped (corner rules, collapsed time), **quoted reply** (quote block edged in the quoted sender's ink, jump to original with a soft forest flash), TTL (hourglass plus live countdown, terracotta 60%), **burning** (ember edge, char, dissolve, 600ms) |
| **FileCard** | image (inline thumbnail), video, audio, file (kind glyph, label, eye, **opens the viewer**, downloading lives inside the viewer and never on the card), **sealed** (view-once), **spent** (ember edge, non-reopenable) |
| **SystemLine** | join, return, leave plus rotate, forged message rejection. Low contrast centered sans. |
| **Composer** | default, composing (auto grow 1 to 3 lines), attaching (slip plus view-once toggle), **replying** (quote slip above the input, Escape releases the quote before anything else), TTL armed (chip cycles OFF to 5m to 1h to 8h), **reconnecting** (send replaced by status), re-sealing, room-full |
| **SealingOverlay (S3)** | arc fill 1.7s plus seal press. Reduced motion: static plus 150ms fades. |
| **BurnOverlay (S6)** | char 2s inward, Lora line 400ms, hold, fade 400ms |
| **VerificationSheet (S7)** | per member row: ink dot, alias, grouped fingerprint, copy, user set verified check. One-tap glossary. |
| **SettingsSheet (S9)** | local name with a private-to-you note, default TTL segmented, member list, burn for the creator or leave for a guest, separated by whitespace and never adjacent |
| **InviteSheet** | link copy, password show and copy, different channels guidance |
| **FileViewer** | image zoom, video, audio, **PDF on canvas** (no toolbar, no save button), text, CSV table, hex dump. Every file opens in-app. View-once spends on open and **has no download anywhere** |
| **ThemeToggle** | daylight and nightfall, CSS driven icons, no hydration guesswork. The switch swings the new icon in with `theme-turn`. |
| **InkMark** | static, breathing (landing), **landing choreography** (fall, squash, splash, halo), **ghost draw-on** (watermarks), scattered (burn), fleck (identity) |

---

## 3. Motion

Standard easing is `cubic-bezier(0.2, 0, 0, 1)`. Durations are 150 for
state, 250 for entrance, 400 for overlay, 600 for burn. Nothing loops
forever except the landing mark's breath and evaporation, the typing
whisper, the watermark drift, and the final countdown pulses, all low
amplitude, all off under reduced motion.

| Trigger | Duration | Easing | Reduced motion fallback |
|---|---|---|---|
| Button, hover, focus state | 150ms | standard | instant |
| Card settle, lists and sheet content | 250ms | standard | 150ms fade |
| **Screen and route entrance (`screen-in`)** | 280ms | standard plus 10px rise | 150ms fade |
| **Message in, self (`msg-in-self`)** | 260ms | from the right margin, one overshoot | 150ms fade |
| **Message in, others (`msg-in-other`)** | 260ms | from the left margin | 150ms fade |
| **Quote flash (`quote-flash`)** | 1300ms, once | a soft forest ring pulses twice then fades, recognition not alarm | static 8% forest tint |
| Sheet in and out, bottom mobile, right desktop | 400ms | standard | 150ms fade |
| S3 seal arc and press | 1700ms + 1740ms | standard | 150ms fade, arc completes instantly |
| **Hero landing, drop falls (`drop-land`)** | 580ms | gravity in, spring out, squash at impact | 150ms fade |
| **Hero landing, flecks splash (`fleck-splash`)** | 460ms, +240ms | stacked on the evaporation loop through independent `translate` and `scale` | disabled |
| **Hero landing, ink halo (`halo-bleed`)** | 800ms, +260ms | stain spreads under the drop | 150ms fade, no delay |
| **Hero hover, flecks lift, ember flares** | 450ms transition | independent properties again | instant |
| **Typing whisper (`whisper-fleck`)** | 1.15s infinite, 3 flecks staggered | rise and fade | static at 55% |
| **TTL final 10s (`ttl-final`)** | 1s infinite pulse | ease-in-out | disabled |
| **Send burst (`send-fleck`)** | 520ms, two pseudo-flecks | standard | 150ms fade |
| **Ghost watermark draw-on (`ghost-draw`)** | 1300ms plus fleck fades | pathLength dash | 150ms draw |
| **Ghost watermark drift (`ghost-drift`)** | 13s infinite, 1.6s delayed | ±6px translate | disabled |
| **Theme turn (`theme-turn`)** | 420ms | −80° swing in | 150ms fade |
| **Message TTL burn** | 600ms | standard | **150ms opacity fade** |
| **Room burn, char inward** | 2000ms | standard | 150ms fade to final state |
| Room burn, Lora line in | 400ms | standard | 150ms fade |
| Room burn, overlay out | 400ms | standard | 150ms fade |
| Reconnecting dot pulse | 1.6s × 3, then rests | ease-in-out | static |
| Landing mark breath and evaporation | 6s + 2.7s infinite | ease-in-out | disabled |
| **In-app notice in (`notice-open`)** | 360ms | grid-rows 0fr to 1fr, the app steps down | 150ms, the global rule |
| **In-app notice out (`notice-close`)** | 300ms | row collapses, card lifts | 150ms, the global rule |
| **Notice card settle (`notice-card-in`)** | 360ms | −12px plus scale 0.985 to seat | 150ms, the global rule |
| Toast seat | Sonner default 400ms | seats at `--toast-top`, header plus notices plus safe area | n/a |

---

## 4. Rationale, one line per non-obvious decision

- Room keys live only in memory. Refresh locking is not simulated, keys
  are really dropped, so the locked state is real rather than cosmetic.
- Argon2id at 64 MiB for new rooms, rather than a token spinner. The S3
  wait is real work and the animation does not finish before the key
  does. (this line used to say PBKDF2 at 750,000 iterations, which is
  the legacy path only now, see §5.)
- The verifier blob, an encrypted known plaintext, lets joiners detect a
  wrong password without the server ever learning the password or a
  hash of it.
- Identity inks are muted stationery tones. Distinguishable at a glance,
  and none of them reads as an accent. Forest and terracotta keep their
  exclusive meanings.
- The signature lives inside the ciphertext, so a malicious relay
  cannot strip or swap it invisibly. Registry pubkeys make forged
  senders detectable, "A message claiming to be from … was rejected".
- Errors are neutral charcoal. Terracotta means impermanence, not
  failure. A wrong password is a fact, not a danger.
- A banner never covers anything. In-app notices open a grid track, 0fr
  to 1fr, at the top of the shell, so the whole app steps down to make
  room. Overlays are for sheets and burns, never an incoming message.
- The top of the screen belongs to one thing at a time. Toasts seat at
  `--toast-top`, which is safe area plus header plus the measured notice
  stack height, published live by a ResizeObserver, so a toast can
  never land on the header or on a banner.
- Notification previews are a preference and the default is sender only.
  The OS shade is exactly where ephemerality is easiest to forget, so no
  message content appears unless the user asks. Files are never quoted:
  the act, not the contents.
- Native notifications ride the service worker,
  `registration.showNotification`, the only path that works on Android
  Chrome and installed iOS PWAs. The page level `Notification`
  constructor is a desktop dev fallback. Taps focus the app and open
  the room. A cold start opens `/#/r/:id`, where a locked room shows its
  unlock sheet, a first-class state.
- The composer's send slot becomes Reconnecting or Re-sealing. The one
  input that never silently accepts text it cannot send.
- Ash cards persist for exactly one session. The burned room stays
  visible for the session and the next page load clears the desk.
- The creator's empty room shows the invite verb, Copy invite link. The
  joiner's shows the product statement, "You won't see messages from
  before you joined. That's how this works."
- The burn is the only centered modal, "This destroys the room and its
  messages for everyone. This cannot be undone.", because it is the only
  irreversible act.
- The sidebar's New room is a low emphasis icon, so no screen ever
  carries two primary greens.
- Local room names are never corrected. Two people may call the same
  room different things and the label is yours alone.
- Unread is a low emphasis mark: a 6px forest dot, and a count pill
  once there is more than none. The dot carries the state, the pill
  carries the number. Nothing else, no streaks, no badges.
  (the old line here said no counts no badges, and the count pill has
  shipped since. see bugs/BUGS.md B36.)
- A quote is a copy, not a reference. The reply carries its own snapshot
  of the quoted words, encrypted inside its frame at compose time, so
  the quote still reads after the original burns. Tapping it jumps to
  the original while it lives in session memory, and shows a plain
  notice when it doesn't, "That message is no longer in this session".
- View-once targets are quoted as "Sealed message". A quote is a
  preview and a sealed card promises no previews, so the reply never
  leaks what opening would have shown.
- Files open in the app and are never handed to the browser. Decrypted
  bytes live in memory behind a revocable blob URL. The viewer decides
  what opening means per type: zoom, play, render, read, inspect bytes.
- A view-once file has no download anywhere, not on the card and not in
  the viewer. Viewing is the point and the plaintext never touches disk
  through us. The standing limit holds, a determined member can still
  screenshot, a policy cannot remove that.

---

## 5. Architecture, protocol v2, Task 19

**Client** (`/`, hash routed `#/`, `#/new`, `#/join/:id`, `#/rooms`,
`#/r/:id`). All crypto in WebCrypto plus hash-wasm and @noble/curves.

- **What the client keeps.** One Zustand store, assembled from slices
  under `src/store/`: lifecycle, registry, sessions, transport, timers,
  messages. The store is the app's memory and nothing else. A room
  keeps at most 500 letters, the oldest first to go, and the file bytes
  live outside the message list, under a 32MB per-room budget. The
  document holds 60 letters at a time; scrolling back brings the older
  ones in. The point is that a room that sits for a day does not turn
  into ten thousand nodes and a hundred megabytes of base64.

- **Entry key (kv 1)**. Argon2id, m=64 MB, t=3, p=1, from the room
  password and a random 16-byte salt carried in a versioned key
  bundle, `{v:2, alg:"argon2id", ...}`, stored on the room. Rooms
  created before the upgrade, the versionless PBKDF2-SHA256 750,000
  iteration bundles, still unlock through the legacy path.
- **Room passwords** (`src/lib/identity.ts`, hardened in Task 26 after
  a security review, default raised to six words in Task 31). Generated
  as six words from a 256-word list: one CSPRNG byte per word,
  `crypto.getRandomValues`, rejection guarded so any future list size
  stays unbiased, duplicates skipped. That is 2^48 candidates. The
  verifier bundle is a public offline oracle, so the keyspace has to
  survive argon2id grinding. The old 24-word 4-pick generator held 18
  bits and drew from `Math.random()`, a predictable stream, and the
  whole space fell in under 7 CPU-hours. The 5-word interim held 40
  bits, a laptop-year, but a ~100-GPU cluster grinds it in months, and
  48 bits multiplies that grind by 256: multi-year even for a large
  cluster, multi-century on one machine.

  Retention policy: the plaintext lives in the memory-only
  `RoomSession` for exactly as long as the room is open. The invite
  sheet re-displays it, masked with a reveal toggle, so members can
  bring someone in at any time, and legacy v1 rooms re-derive epoch
  keys from it. It is never written to disk, refresh locks every room
  and empties it. Password inputs clear the moment their job is done,
  mask by default with a keyboard-operable reveal toggle, and declare
  `autocomplete="new-password"`, the documented suppressor. `off` is
  advisory and Chrome would otherwise offer to save an ephemeral room
  password into its on-disk manager.

  Since Task 27 they are also uncontrolled by construction.
  `PasswordField` omits `value` and `defaultValue` from its props,
  because a controlled React input mirrors every keystroke into the DOM
  `value` *attribute*, which put the plaintext in the Elements panel,
  in React DevTools state, and in reach of DOM-attribute scans even
  while the field rendered as bullets. The secret field never writes
  the attribute at all and holds nothing in React state. Parents seed
  and wipe it imperatively through the DOM property, `el.value = …`,
  read it once at submit, and the plaintext dies with the input node on
  unmount.

  Inherent limit, stated plainly: the DOM `value` *property* of any
  input is always readable from the user's own browser, `$0.value` in
  the console. That is true of every site that ever had a password box.
  That is the irreducible minimum, since the page must be able to read
  the secret to encrypt with it. Masking and the absent attribute defend
  against shoulder-surfing, screenshots and casual inspection, not the
  user's own machine, which is the user's to inspect.

- **Wire protocol v3** (`src/lib/protocol.ts`). Every frame is body
  JSON, sign with ECDSA P-256 over the canonical, pad to a fixed size,
  AES-256-GCM. Control frames, which is text, typing, receipts, burns,
  key offers and file metadata, are uniformly 20480+16 bytes. A file
  transfer is 1 meta plus chunks of 65536+16, and the file is padded to
  the smallest size bucket that holds it: 64KB, 256KB, 1MB, 2MB. So a
  1KB file travels in 3 frames and a 2MB file in 45. The relay cannot
  tell typing from a message, and it learns the bucket rather than the
  file's true size.

  The receiver checks the chunk shape before it stores anything. The
  total has to be one of the buckets' chunk counts, the seq has to be
  an integer inside it, and the chunk payload has to be at most 64,000
  characters. The
  meta has to be sane too: the size inside the format's limit, a
  lowercase sha, a name and a mime within bounds. And the pending
  transfers share a byte budget, 16MB of chunk strings, with the
  oldest transfer dropped when the budget is reached. Before that, a
  member could name any total and any seq and have the assembler hold
  all of it. See bugs/BUGS.md B3.

  What is signed: the whole frame body. `canonicalV3FromBody` takes
  the body out of its own signature, serialises it with sorted keys,
  hashes it, and puts that hash under a length-prefixed room id. So
  `ttlSec`, `typing`, the nested `file` object, the chunk payload and
  the contents of a key offer are all covered, along with anything a
  later version adds. The old canonical joined fields with a pipe and
  escaped only one of them, so two different bodies could produce the
  same signing string. That is what bugs/BUGS.md B1 and B2 were about,
  and protocol v3 is the fix.

  v2 frames are refused rather than verified, because a v2 signing
  string cannot be trusted to mean one body. A v3 build and a v2 build
  do not hear each other. The split is quiet: no rejection lines, the
  room just goes still.

- **Quoted replies** (round 29, `src/lib/types.ts` plus
  `src/lib/protocol.ts`). A reply carries a snapshot of its target,
  `ReplySnapshot {id, senderId, snippet, file?}`, built at reply-compose
  time by `makeReplySnapshot()`. View-once targets are quoted as
  "Sealed message", never by their contents. File targets quote the
  file's name with `file: true`. Text targets are whitespace-collapsed
  and capped at `REPLY_SNIPPET_MAX = 120` characters.

  The snapshot travels inside the encrypted frame body, and the signature
  covers the body, so the quote is covered exactly as unforgeable as
  the words it carries. Under v2 the quote was a twelfth slot in a
  pipe-joined string. Under v3 it is part of the hashed body, which
  also means a quote cannot be swapped for a different quote without
  breaking the signature. A test proves that by signing one quote and
  verifying a forged one.

  A tampered quote breaks the ECDSA signature, proven by a direct test
  rather than asserted. Verification recomputes the canonical from the
  raw snapshot before any sanitising, because the receiver must rebuild
  the sender's exact string, and only then does `sanitizeReplySnapshot()`
  gate the view layer, id and senderId capped at 64 chars, snippet at
  160, malformed shapes dropped, and a failing snapshot renders the
  message unquoted rather than broken. Reply frames ride the same
  uniform control-frame size, so a reply is size-indistinguishable from
  a plain message.

  The failure mode for a mixed-version session: a v2 tab beside a v3
  tab. They do not hear each other at all. v2 frames are dropped by a
  v3 build and v3 frames are dropped by a v2 build, because a v2
  signing string cannot be trusted to mean one body. The message is
  lost for the old tab, never forged.

- **Replay defense**. Per-sender monotonic counters inside a
  per-page-load session tag, a ±10-minute timestamp window, frame-id
  dedup, and watermarks persisted per room per device so they survive
  refresh.

- **Identity**. One random device seed, held as a non-extractable
  WebCrypto key in IndexedDB, never written to disk in readable form.
  Each room derives its own ECDSA P-256 signing key via
  HKDF(seed, roomId), so the same device in two rooms has different
  pubkeys and aliases and registries cannot be correlated. Session ECDH
  P-256 pairs regenerate every page load, memory only.

  Room personas (Task 48, `src/lib/room-persona.ts`). Every window of a
  browser shares that seed, so a second window in the same room would
  derive the same identity and silently re-join as the first window's
  member, misattributing messages, sticking the member count and
  overwriting the session ECDH. The first window to enter a room claims
  a Web Lock and keeps the vault identity, byte-identical to
  single-window behaviour, so fingerprints and verification marks
  survive. Additional concurrent windows derive under a distinct HKDF
  info prefix, `cc-sig-tab-v1:<nonce>`, nonce in per-tab
  sessionStorage, sticky across that tab's refreshes, and register as
  their own members with their own aliases. Locks auto-release when the
  tab closes or crashes, and browsers without `navigator.locks` keep the
  legacy single-identity behaviour.

  Fallback, and it is the honest part: when IndexedDB is unavailable
  the legacy loader runs, and it writes the raw 32-byte seed to
  localStorage under `cc.seed`. `src/lib/seed-vault.ts` claims the seed
  stays in memory for the page load only in that case. It does not. See
  bugs/BUGS.md B38.

- **Key rotation** (`src/lib/room-protocol.ts`). When a member leaves,
  the deterministic coordinator, the lowest memberId among connected
  members, generates a random key that is never derived from the
  password, and delivers it pairwise over authenticated ECDH, signed,
  encrypted under the entry key so every member can read the offer but
  only the recipient can unwrap it. Departed members are evicted from
  local registries and their frames are refused. The server's room
  epoch is a persistent rotation ledger, so rejoiners rotate past any
  key a departed member may still hold, and unanswered key requests
  self-heal through fallback rotations that converge monotonically.

  A key version is a pair: the server's rotation epoch, and a fresh
  random offset inside it. The pair compares as one number, so a
  version from a later epoch always wins, and two members rotating at
  the same time land on two different versions. The higher one wins
  and the lower one takes it. Before this, a version was the next
  number above the one held, so two clients could install two
  different keys under the same number and read nothing of each other
  afterwards. See bugs/BUGS.md B4, fixed.

  The residual: two rotations in the same epoch that draw the same
  32-bit offset would still collide. One in four billion. The other
  way out is the server handing out every version, which costs a
  round trip in the middle of the rotation ceremony.

- **Join delivery**. A member rejoining after a rotation receives the
  current key as an ECDH-wrapped offer additionally encrypted under the
  entry key, so only a joiner who proved the password can open it.

  Note on the readme sentence "The leaver never receives it". True
  while they stay out. Any password holder rejoins with current access,
  and the e2e test asserts exactly that. See bugs/BUGS.md B10.

- **Image metadata, EXIF stripping** (Task 31, `src/lib/media.ts` and
  the composer's attach path). A photo must not leak where it was
  taken. Before an image is attached its bytes are scanned by a pure,
  byte-level detector for the segments that hold camera metadata: JPEG
  `APP1`, which is EXIF *and* XMP packets, and `COM` free-text comments,
  PNG `eXIf`, `tEXt`, `iTXt`, `zTXt` and `tIME` chunks, WebP `EXIF` and
  `XMP` chunks. Clean files pass through untouched, no re-encode, no
  quality loss, no cost, since most screenshots and downloads are
  already clean. Files that carry metadata are re-encoded through a
  canvas, decode then draw then encode, JPEG and WebP at quality 0.92
  and PNG losslessly, and it is the re-encoded bytes that get encrypted,
  so the output holds none of the original's metadata.

  Fail-closed: if the re-encode fails or outgrows the file limit on a
  file that carried metadata, the file is not attached at all and the
  failure surfaces as a notice, never a silent send of location data.
  Scope, decided: SVG, no EXIF and never rasterised since its scripts
  are neutralised by the img-context viewer, and GIF, comment-only
  metadata surface and a re-encode would kill the animation, pass
  through. Cost note, the re-encode is a one-time decode and encode on
  the sender's machine at attach time, imperceptible for photos. The
  attachment slip shows the re-encoded size, so the size shown is the
  size encrypted and sent.

- **In-app viewing** (round 29, `src/components/cc/file-viewer.tsx`).
  Every file opens in the app: images zoom, video and audio play, PDFs
  render, text, CSV and binary are read right there. Nothing is handed
  to the browser's own viewer and nothing is force-downloaded. The
  decrypted bytes decode once to memory and render through revocable
  blob URLs, created in an effect keyed on the message id and revoked on
  switch and unmount. Nothing is fetched, nothing is written.

  A view-once file has no download anywhere. The Download button exists
  only for regular files, PiP and the context menu are suppressed on
  view-once media, and the viewer states the policy outright, "There is
  no download for this file, from anyone, by design". PDFs render
  through `pdfjs-dist` onto a `<canvas>`, the worker vendored at
  `public/pdf.worker.min.mjs` and served from `/pdf.worker.min.mjs`,
  because a canvas carries no browser PDF toolbar and therefore no save
  button. If pdf.js cannot load the document, regular files fall back to
  an `<iframe>`, but view-once PDFs stay unopened rather than expose the
  browser toolbar's save button, and the notice says exactly that.

  HTML is never executed, it renders as escaped source with the line
  "Shown as source: HTML is never executed here". SVG is only ever
  shown through an `<img>`, the context where its scripts cannot run.
  Text is capped at 100 KB on screen while copy takes the whole file.
  CSV parses quote-aware into a capped table. Unknown binaries get a
  metadata card and a hex dump of their first 512 bytes.

**Server** (Next.js API routes plus Prisma/SQLite). Room lifecycle, the
member registry, the only identity authority, keyed by pubkey so a
forged relay join cannot overwrite a real member, creator-token
authorized burn, epoch ledger bump on leave, and since Task 22 leave
itself requires proof of possession, a signature from the member's own
room key. Never sees plaintext or passwords, stores no messages.

The registry also holds the join verifier: an HMAC over the key
derivation output, bound to the room, kept in a column it never
publishes. A client proves knowledge of the password by HMAC-ing a
timestamp and a nonce with it. The roster and every member write want
that proof, so a link holder can join nothing and read nobody. The
alias and the ink are the server's derivation from the member's public
key, and what the client sends is ignored.

All registry-touching endpoints are rate limited per IP: room creation
5/min, room info and verifier 30/min, member joins 12/min, leave 20/min.
There is no moderation endpoint. The server holds no content, so it has
nothing to review, no member to suspend and no history to scrub, and
the only act it could take was ending the room. Every path to that act
was reachable by anyone holding an invite link, grading included. See
§6.

Two things about the registry that the section above does not say:

- Updating an existing member proves possession of the registered key.
  The route finds the member by pubkey, so a stranger can post a
  member's pubkey back, and the update carries a signature from that
  member's own key over the room and the ECDH key being written. The
  proof names the ECDH key, so a captured one cannot be replayed onto
  the attacker's key. The join path writes a new row, so it needs no
  proof: there is nobody to take over. See bugs/BUGS.md B6, fixed.
- Creating a member needs proof of the password. The server holds a
  join verifier, an HMAC over the key derivation output bound to the
  room, and the client proves knowledge by HMAC-ing a timestamp and a
  nonce with it. The proof is ten minutes wide, so a captured one is
  useless later. The roster is behind the same proof. The server
  cannot derive the room key from the verifier and the password never
  leaves the client. See bugs/BUGS.md B7, B8, B9, fixed.

**Relay** (socket.io mini-service, :3003, in-memory). Blind
uniform-frame forwarding, presence, key requests. Token bucket rate
limit, 20 frames/sec sustained and a 64 burst, per socket, and a second
bucket at 1MB/s with an 8MB burst charged with each frame's own size.
Oversized frames are a protocol violation and hard-disconnect. At most
16 rooms per socket. No DB and no history, so new joiners see nothing
from before they joined, by construction. Its internal second port,
:3004, token guarded and never gateway-routed, is the same process
rather than a separate service, and serves the presence snapshot the
evict path consults plus, since Task 31, `POST /terminate/:roomId`,
which is how the registry tells every connected member a burned room is
gone.

A socket speaks only for the member ids it claimed at join time, so a
client cannot announce that somebody else left or type under another
name. The relay still cannot tell whether a claimed id is real; the
REST registry can, and the client checks against it. Its CORS answers
only the app's origin. See bugs/BUGS.md B16, B17, B32, fixed.

---

## 6. Threat model, what this does not protect against

Accurate claims only. These are the main limitations.

- **Metadata.** The relay sees who talks to whom, when, room ids, frame
  counts and presence. Frames are size-uniform, so content type and
  message versus typing are hidden. A file's size is hidden inside a
  bucket: the number of chunk frames says which bucket it is in, and
  the true size stays inside the encrypted meta frame. The fact and the
  volume of communication are not.
- **View-once is a UI promise, not enforcement.** Any member can
  passively decrypt a view-once file on receipt and keep it without ever
  opening the viewer. Inherent to group E2EE, Signal has the same limit.
- **Silent leavers, bounded by the grace.** Rotation fires when a member
  announces departure, and since round 21 also when they silently
  vanish: every remaining client starts a 2-minute grace clock on the
  disconnect, and the connected coordinator, the smallest memberId
  among live members, asks `POST /api/rooms/:id/evict` to write them out
  and bump the epoch. The route fails closed. It consults the relay's
  live presence snapshot, token-guarded and server-to-server on an
  internal port, as the connection authority, requires the caller to be
  live and the target to have been offline for at least a minute. The
  residual is the 2-minute window itself. For a hostile exit, burn the
  room. A nuisance-evicter who knows only the roomId can force a
  rotation while someone is away, and the departed member re-enters with
  the password, the same accepted-risk class as insider nuisance
  rotations.
- **Insiders can always sabotage.** Any current member can push a
  nuisance rotation, leave garbage, or publish the room key out-of-band.
  Group E2EE cannot defend against a malicious participant, it only
  keeps outsiders out.
- **A room ends when its clock runs out, when its creator burns it, or
  when the operator terminates it. Nothing else ends a room.** There is
  no report endpoint and no report button. The server never sees
  plaintext, so it cannot review content, suspend a member or scrub
  history; the only act moderation could take was ending the room, and
  the report endpoint was that act with a credential problem. The
  graded version read as safe because a report had to carry a signature
  from a registered room key, but registering took no proof of anything,
  so a link-holder could register and then burn. An anonymous report
  was worse: three distinct IPs counted, the tally lived in memory, and
  the server kept a reporter's free text for seven days against the
  nothing-stored promise. Grading bought the shape of moderation
  without the substance, so the feature went. The creator's burn button
  stays: the creator holds the creator token, and a creator who wants
  their room gone is not an abuse case. The operator keeps the
  token-guarded relay `/terminate` for the legal path. The room ID
  remains the weakest credential, it appears in every invite link, but a
  link-holder's powers are capped: join and see ciphertext, presence
  noise, rate-limited spam, and nothing else. The operator contact,
  lilice308@gmail.com, README plus Settings then About, is the whole
  abuse surface.
- **The room password is immutable** for the room's lifetime, because
  the verifier is set once at creation. Password knowledge can never be
  revoked. Rotations exist so the key stops depending on it.
- **Endpoint compromise.** A compromised device, through XSS, malware or
  physical access, reads everything and impersonates the user. Nothing
  in a browser can prevent this. The tree now sends a
  Content-Security-Policy with a per-request nonce and the usual
  headers, which raises the cost of an injection but does not make a
  compromised device safe.
- **The relay and REST API are unauthenticated at the transport layer**,
  by design, since there are no accounts. Forged relay joins cannot
  poison identity, the REST registry is authoritative and keyed by
  pubkey, and forged leaves cannot force rotations, confirmed against
  REST first. They can appear as transient presence noise.
- **Replay residuals.** Replayed frames are refused within a device's
  memory and across refreshes, through persisted watermarks, but a frame
  captured inside the ±10-minute window can be delivered once to a
  device that has never seen the room before, a fresh joiner on a new
  device for instance. No history is stored anywhere. That is the
  residual cost of not trusting the relay with sequence numbers.
- **What lingers on your device.** The desk lives in localStorage: room
  cards, which are local names, unread counts and other metadata with no
  secrets, creator tokens, which are burn authority so treat device
  access accordingly, verification marks, and per-room replay
  watermarks. Keys and message bodies are memory-only and die with the
  tab. The one exception is the device seed, held as a non-extractable
  key in IndexedDB. Scripts cannot read its bytes back, but an attacker
  with full access to the browser profile directory can still copy the
  underlying files, which is documented here.
- **Not a nation-state adversary.** If your opponent is one, use Signal
  or SimpleX.

Residuals closed in Task 22: leaving now requires proof of possession, a
signature from the member's own room key, so a leaked memberId alone
cannot write someone out or rotate the room out from under everyone.
The room info, verifier and members endpoints are per-IP rate limited,
so the existence and epoch oracle and the registry write path are not
scrapeable at will. The member cap is a freshness-windowed soft cap: it
stops a code-holder without the password from permanently locking the
room with throwaway keys, but a coordinated attacker with many IPs and
keys can still exceed it. Presence noise, not a confidentiality break.

Closed since: joining proves knowledge of the password, the roster is
behind the same proof, and the alias and the ink are derived by the
server from the member's public key. The update path proves possession
of the registered key, so overwriting a member's ECDH key is closed too.
The proof is an HMAC over the key derivation output, bound to the
room, kept in a column the server never publishes, freshened by a
timestamp and a nonce with a ten minute window. The server cannot
derive the room key from it and the password never leaves the client.
Rooms sealed before the proof existed keep the old rule: the server
cannot invent a verifier for them, so a link holder can still register
there and read that roster. See bugs/BUGS.md B7, B8, B9.

---

## 7. Marketing page rules

These rules govern the landing and the document surfaces, Task 40
onward, amended in rounds 3 to 5.

- Swap test. Cover the wordmark. If the page could sell any other
  privacy product, redo it. Identifiability comes from the product's own
  elements, its mark, its verbs, its copy, never from an arrangement of
  zones.
- Behavior claims on marketing pages, algorithm names in the docs. "The
  relay cannot read a single frame" is a behavior claim in plain words
  and it is checkable. A cipher's name is vocabulary and vocabulary is a
  flex. Algorithm names live in README, SECURITY and the protocol
  reader, linked from the footer.
- One aphorism per product. The voice already chose it: A conversation
  that leaves no trace. No other tagline ships on any surface.
- One gesture per page, carried fully. The burn overlay is the
  reference: one decision, the room chars, carried through phases. A
  page gets at most one performed gesture, everything else is
  typesetting or a standard state change.
- Marketing pages use house classes only. The same verb system,
  sentence case, forest primary, quiet secondary, never the ALL-CAPS
  tracking-wide button, the same paper, the same mark, the same fonts
  the product uses. A marketing page adds zero CSS of its own. If a
  marketing page needs a new class to be itself, that is staging.
- No staging. Round 3, Task 41, removed staging that looked like AI
  output: a prop sheet rotated on a desk, a struck-through word in the
  headline, doubled grain, a performed sealing gesture. Identity comes
  from what the product already owns, the paper, the forest, the ink
  drop, the one aphorism, its header, its entrance, its breathing mark,
  its verb system, its footer caption, never from an arrangement of
  props.
- Document pages use house fonts. Round 4, Task 42: the same Lora,
  Inter and Plex Mono, the same paper, the same hairlines, the app's own
  header. Plain headings in sentence case. Labels in sentence-case
  Inter, never mono ALL-CAPS. The copy speaks plainly, no conceits, no
  field notes, no receipts, no clever-fragment titles. A heading says
  what the section is and a sentence says the thing. A document page is
  allowed one table, numbered steps and code in mono, because those are
  what documents actually use.
- Plain vocabulary. Round 5, Task 43: public copy carries zero
  em-dashes, the one exception being the tagline's own dash, and
  vocabulary says the plain thing. "Generated" not "minted", "encrypted"
  not "sealed", "derived" not "stretched", "runs on every push" not
  "standing gates", "known limits" not "residuals". Standard crypto
  terms survive, key stretching, AES-256-GCM, argon2id. Metaphors do
  not. Flat sentences also leave numbers nowhere to hide: every number
  in public copy has to hold on its own against the code. Round 5's
  catch: "room lifetimes up to a day" was wrong by a factor of thirty,
  the picker says minutes to 30 days or until burned, and message timers
  go down to 5 seconds rather than 15, the custom floor `TTL_MIN_SEC`.
  The covenant sentence, claims are checked against the code and known
  limits are written down rather than hidden, ships in exactly one
  place, the author section, and even there it ships flat.

Surfaces, one route and three modes. `/` is the landing: flat, centered,
nothing rotated, nothing floating, no shadow, no performed gesture. The
breathing mark, the Lora headline, one Inter meta line, two house-styled
buttons, the trust caption, the docs links in the footer. `/?read=1` is
the protocol page: a plain document in the house fonts, an "On this
page" line, hairline sections, one table, one live example. `/?app=1` is
the product itself, unchanged.

The landing footer line, "Messages are encrypted in your browser. Set them
to disappear on a timer if you want. We can't read them.", used to say
"destroyed on schedule" and "Neither can anyone else", which overclaimed
on both counts: TTL is off by default, and room members can read
everything. See bugs/BUGS.md B34.
