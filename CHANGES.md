# CipherChat — Complete Change Record

A detailed, chronological record of every change and addition made to the
project, cross-referenced against the internal task IDs used in
`worklog.md`. Final state at time of writing: **139/139 property tests
green, lint clean (0 errors, 0 warnings), tsc clean, all services
healthy.**

**What the product is:** an end-to-end-encrypted, ephemeral group chat.
All cryptography runs in the browser; the server is a blind relay that
stores no messages; rooms die on a clock (or by fire); the only identity
is a per-room deterministic alias in a muted ink colour. Single
user-visible route (`/`), hash-routed client-side. Aesthetic: warm
paper, ink, and forest — deliberately *not* cyber/hacker.

---

## 1. Foundation (Tasks 0–8)

### 1.1 Architecture decisions (Task 0)

- **One route, hash router**: `/` with `#/`, `#/new`, `#/join/:id`,
  `#/rooms`, `#/r/:id`. Invite links use `/?join=<roomId>`.
- **Crypto in the browser**: room key derived from the room password;
  AES-GCM message encryption; per-device signing keys; forged messages
  (bad signature) are quietly rejected.
- **Server is a blind relay**: REST for room lifecycle + member
  registry (keyed by pubkey), socket.io mini-service `:3003` for
  in-memory presence and message relay. **No message persistence —
  new joiners see no history, by design.**
- **Refresh = keys wiped** (memory only) → rooms lock; the room list
  survives in localStorage; locked rooms unlock by re-entering the
  password.
- **Identity**: deterministic alias (adjective + animal, e.g. "Quiet
  Heron") + one of 8 curated muted ink colours, derived from the
  fingerprint of the member's signing pubkey. No red/terracotta hues
  (terracotta is reserved for impermanence/destruction).

### 1.2 Design system (Task 1)

- `globals.css`: full token sheet for two themes — **Daylight**
  (paper `#F4F1EB`, side `#EBE7DF`, charcoal `#2C2A28`, forest
  `#3A4F41`, terracotta `#C85A40` for destructive/impermanent only,
  ember `#E8A87C` for motion only) and **Nightfall** (dark, warm,
  low-contrast).
- Typography: **Lora** (the human voice — messages, names, headings),
  **Inter** (the machine voice — chrome, labels, meta), **IBM Plex
  Mono** (fingerprints, codes, timers).
- Grain overlay, custom keyframes (breathe/settle/rise/seal/burn),
  mandatory `prefers-reduced-motion` overrides (150 ms single fades).
- Custom Tailwind tokens: `hairline`, `paper`, `side`, `wash`,
  `charcoal`, `mute`, `forest`, `terracotta`, `ember`.

### 1.3 Backend (Task 2)

- **Prisma schema** (`prisma/schema.prisma`): `Room`
  (id / verifier / creatorToken / epoch / burned / expiresAt added
  later) + `Member` (pubkey / alias / colorIdx / active / lastSeenAt,
  unique `[roomId, pubkey]`), SQLite at `db/custom.db`.
- **API routes** (`src/app/api/`): `POST /api/rooms` (create),
  `GET /api/rooms/:id`, `PUT /api/rooms/:id/verifier` (set-once),
  `POST/GET /api/rooms/:id/members` (registry, cap 12, upsert by
  pubkey), `POST /api/rooms/:id/leave` (epoch bump), `POST
  /api/rooms/:id/burn` (creatorToken-gated) — later joined by
  `PATCH /api/rooms/:id` (creator TTL adjust) and `POST
  /api/rooms/:id/evict` (silent-departure eviction).
- **Relay mini-service** (`mini-services/chat-service/`, port 3003,
  socket.io, in-memory): room:join, message:send, message:spent,
  member:leave / member:presence / member:typing / member:expired,
  room:burn / room:state. Blind: no DB, no message storage, 16-room
  cap per socket, frame-size cap → hard disconnect, token-bucket rate
  limit per socket (20 frames/s sustained, burst 64).

### 1.4 Client libraries (Task 3)

- `lib/crypto.ts` — WebCrypto wrappers: AES-GCM, ECDSA P-256
  canonical signing, verifier blobs.
- `lib/identity.ts` — wordlist aliases, inks, fingerprint formatting,
  passphrase generation, room-code parser.
- `lib/session.ts` — memory-only room sessions (keys, password);
  refresh locks rooms.
- `lib/local.ts` — desk cards, verified marks, per-room settings
  (localStorage; metadata only, never secrets).
- `lib/relay.ts` — single shared socket via `NEXT_PUBLIC_RELAY_URL`.
- `lib/format.ts` — timestamps, TTL countdowns ("42s", "3d 04h").
- `store/app.ts` — the zustand orchestrator: hash router, room
  lifecycle, send/receive pipelines with signature verification, TTL
  scheduling, presence, unread dots.

### 1.5 All screens (Tasks 4–5)

- **S1 Landing** — one decision in five seconds: create, or join.
- **S2 Invite** — where a shared link lands; prefilled code,
  wrong-password neutral errors, "what happens next" disclosure.
- **S3 Sealing overlay** — the vault-press theatre while keys derive
  (minimum-duration theatre + real derivation).
- **S4 Room list** — the desk: locked cards (lock glyph), unlock
  sheet, ash state for burned rooms, unread dots.
- **S5 Chat** — header with a single shield glyph, grouped bubbles
  with corner rules, file cards, sealed/spent view-once cards,
  composer with TTL control + attach + view-once toggle +
  Reconnecting/Re-sealing states.
- **S6 Burn overlay** — char-in (2 s) → Lora line → fade; the room
  burns for everyone.
- **S7 Verification** — fingerprints computed from pubkeys, copy,
  verify marks, glossary.
- **S8 Empty states** — creator ("Invite someone to begin") and
  joiner ("You won't see messages from before you joined") variants.
- **S9 Settings** — local room name, default TTL, members, burn with
  a centered consequence dialog.
- PWA manifest + icon set.

### 1.6 First QA round (Task 6) — nine bugs fixed

1. `member:joined` broadcast lacked pubkey → receivers rejected all
   messages as "signature invalid" (relay now carries the JWK).
2. `rejoined` flag always true → "X returned." on first joins.
3. `message:ack` is room-scoped.
4. Composer TTL chip was cosmetic — the send path ignored it
   (`ttlOverride` param added).
5. zustand `?? []` selectors → `getSnapshot` infinite loop (stable
   `EMPTY` constants).
6. `creatorToken` was memory-only → creator couldn't burn after
   refresh (now device-local).
7. `#/` always redirected to rooms → landing unreachable (`#/new`).
8. Ash card never displayed — the sweep filtered burned cards on
   every call (sweep now once per page load).
9. Stale locked view after unlocking from a direct URL (chat screen
   subscribes to the messages slice).

Verified end-to-end: two-member E2E with signature checks,
fingerprints matching across clients, view-once sealed → open →
spent-for-everyone, TTL countdown + burn choreography, mobile 390 px,
Nightfall, relay outage → "Reconnecting" → auto-reconnect + rejoin.

### 1.7 Styling polish pass (Task 7-a, frontend-styling-expert)

- Landing rhythm tightened; deliberate focus-visible rings (the
  global outline was invisible on forest-filled CTAs);
  `[@media(max-height:720px)]` compaction for short screens.
- Room cards: paper-lift hover (`hover:-translate-y-px`, no shadows),
  locked cards "sleep", unread dot seated on the x-height, ash cards
  get a quiet diagonal strikethrough.
- Composer: focus transitions, standardized disabled dimming, TTL
  chip hover borders, attachment slip restyle, 44 px hit areas.
- Bubbles: tabular-nums countdowns (no width jitter), stabilized
  sender-alias rows, system-line rhythm, file-card hovers.
- Chat header: real active states (bg-wash + scale-0.96), truncation
  with title tooltips.

### 1.8 Deliverables (Task 8)

- `DESIGN.md` written: token sheet, component inventory, motion spec,
  rationale lines, architecture record.

---

## 2. Feature rounds 1–3 (Tasks 9–17)

### Round 1 (Tasks 9–12)

- **Typing indicators**: relay `member:typing` broadcast (blind,
  transient); 3.5 s TTL with prune timers, 2.5 s emit throttle,
  cleared on message arrival; quiet ink-alias whisper line in a
  reserved 26 px strip ("Velvet Owl is writing…"), `aria-live=polite`,
  no layout jump.
- **Attachments three ways**: paperclip, drag-and-drop (dashed forest
  "Release to attach" overlay), clipboard paste into the textarea;
  chunked base64 (8 KB) for large files.
- **Time-gap dividers**: quiet centered timestamps between messages
  >30 min apart, `role=separator`.
- **Message length guard**: maxLength 4000 + near-limit counter
  (terracotta at zero, calm copy).
- **Sheet grabbers**: 36×4 mute handles on all mobile bottom sheets.
- Operational lesson recorded: `bun --hot` does **not** reliably
  reload socket.io handlers — the relay must be manually restarted
  after edits.

### Round 2 (Tasks 13–15)

- **Invite sheet restructure**: actions on the label row, full-width
  `break-all` mono value boxes — long passwords fit one line at
  390 px; revealed password gets `select-all`.
- **Scroll-to-bottom affordance**: quiet pill appears >220 px from
  the bottom with content overflow; shows "Latest" or "N new
  messages" (peers only); smooth scroll (auto under reduced motion).
- **Message copy context menu** (Radix ContextMenu): right-click
  desktop, press-and-hold mobile, quiet single-item paper-styled
  menu.
- **PWA service worker** (`public/sw.js` + `sw-register.tsx`):
  network-first navigations, stale-while-revalidate for static
  assets, **never caches `/api/` or socket.io** — ephemerality
  preserved; versioned caches cleaned on activate.
- Tailwind lesson recorded: custom `shadow-float` class loses to
  shadcn base `shadow-md` (utilities layer beats components) — use
  arbitrary values.

### Round 3 (Tasks 16–17) — mobile keyboard bug

**User-reported:** "on mobile, the keyboard covers the modal/bottom
popup." Root cause: iOS Safari overlays the keyboard over the layout
viewport; fixed-position sheets anchored to the un-resized ICB.

- **New hook `use-keyboard-inset.ts`**: measures the keyboard via the
  visual-viewport formula, publishes `--kb-inset` (px) on `<html>`;
  rAF-batched; 0 px unless an editable is focused (no desktop/URL-bar
  false positives).
- `layout.tsx` viewport meta: `interactive-widget=resizes-content`
  (Android resizes natively; mechanisms never double-count).
- `ui/sheet.tsx` bottom variant: `bottom-[var(--kb-inset,0px)]` +
  `max-h-[calc(100dvh−kb-inset)]`, 250 ms transition; tall sheets
  scroll inside.
- App shell gets matching padding-bottom — the composer, typing
  strip, and message column rise above the keyboard.
- iOS input-zoom guard: 16 px font on coarse-pointer WebKit inputs
  (unlayered so it outranks utilities).
- QA simulated the exact on-device var (`--kb-inset: 301px` at
  390×844) and verified all three surfaces + blur reset + desktop
  no-op.

---

## 3. Protocol v2 — the security hardening pass (Task 19)

The largest single change to the codebase, driven by an external
acceptance review. **All six property suites were written RED first.**

- **Replay defense (P0)** — `lib/protocol.ts`: per-(sender, session)
  monotonic counters, ±10-minute timestamp window, frame-id dedup,
  FIFO cap; receive pipeline order fixed as shape → registry eviction
  → key version → signature → replay → dispatch. Watermarks persist
  per room per device (survive refresh).
- **Uniform padding (P1)**: every control frame is JSON → ECDSA sign
  → pad → AES-256-GCM at a uniform **20480+16 bytes** (20480 chosen
  because the 4000-char worst-case UTF-8 message cannot fit the
  spec's 4096 — uniformity is the property). File transfers: payload
  padded to a fixed 2.8 M base64 chars, always **exactly 45 uniform
  frames** (1 meta + 44 chunks) regardless of true size — the relay
  cannot distinguish typing from messages or read file sizes.
  **Typing became an encrypted uniform frame.**
- **KDF upgrade (P1)** — `lib/kdf.ts`: PBKDF2 → **argon2id**
  (m=64 MB, t=3, p=1, hash-wasm) with random 16-byte salt in a
  **versioned bundle** `{v:2,…}`; legacy PBKDF2 rooms still unlock.
- **Per-room identity (P1)** — `lib/room-identity.ts`: one device
  seed; per-room ECDSA keypair = HKDF(seed, roomId) — same device,
  two rooms ⇒ different pubkeys and aliases (registries cannot be
  correlated). Old global device key retired.
- **Real key rotation on leave (P0)** — `lib/room-protocol.ts`
  `RoomCipher`: the coordinator (lowest memberId among connected)
  generates a **random** 256-bit key (never password-derived),
  delivers it pairwise over authenticated ECDH, signed, sealed under
  the entry key — every member can read the offer, only the
  recipient can unwrap the key. The **server epoch is the rotation
  ledger** (persisted): post-refresh rotations re-seal past any key
  a departed member held; key requests self-heal through
  version-randomized fallback rotations that converge monotonically.
- **Relay/API hardening (P2)** — `lib/rate-limit.ts`: token bucket
  per socket, IP limit on room creation.
- **Adversarial review (subagent, read-only)** found and the round
  fixed: unauthenticated relay joins (registry poisoning → REST-
  authoritative writes), unauthenticated leave, a legacy spoiler
  frame, v1 downgrade in v2 rooms, missing key-request sender, kv
  saturation brick (KVERSION_CAP 1e6), unbounded maps (capped).
- Test count: **47/47**. Test count milestone: first 92-test run
  came later. Browser E2E covered rotation, rejoin key delivery,
  file transfer through 45 uniform frames with sha-verified
  assembly, and refresh-lock + argon2id unlock.
- `README.md` created, including the honest **"What CipherChat does
  NOT protect against"** section; DESIGN.md gained §6 threat model.

---

## 4. Round 20 — captions, ink reactions (Tasks 20-0…20-c)

- **Bug fixed (found by QA)**: text typed alongside a file attachment
  was **silently dropped**. Fix: the caption rides the meta frame's
  canonical-signed top-level text field — exactly as unforgeable as a
  message; rendered above the file card; "Copy caption" added.
- **Ink reactions** (protocol → UI): four product-vocabulary marks —
  ✓ Acknowledged · ✦ Noted · ♥ Warmly received · ☾ Later. New
  `react` frame kind (glyph in the signed text field, target in
  `messageId`); one mark per sender per message; toggle transitions
  converge identically on every client; "Mark this message" context
  submenu + marks bar chips under bubbles with who-marked tooltips.
- **Escape-to-rooms**: in an active room with an empty composer,
  Escape navigates to the room list (sheets/menus/dialogs own the key
  first).
- **Service-worker dev guard**: SW no longer registers in development
  — closed the stale-chunk class of QA failures permanently.
- Styling pass: staggered landing entrance, presence ink dots in the
  header (per-member colours, away = 35% opacity), typing-line ink
  dots, jump-pill lift, hover micro-interactions.

---

## 5. Round 21 — silent-departure grace + UX (Tasks 21-0…21-4)

- **Silent-departure grace** (the documented "silent leaver retains
  keys" gap, closed): relay stamps an offline clock on silent
  last-socket drops; clients watch a 120 s grace; the server
  **verifies against live presence before writing anyone out** (`POST
  /api/rooms/:id/evict` gathers DB registry + relay snapshot from a
  token-guarded internal presence endpoint on `:3004`); the epoch
  ledger makes the re-seal durable; the departed member re-enters
  with the password. "X drifted away." system line; honest-diff
  presence also fixed the stale away-dot after refresh.
- **Composer drafts** per room (memory-only like the keys): the draft
  swaps with the room, cleared on send/leave/burn; a soft
  forest-ring pulse when a draft restores.
- **Composer auto-focus** on room entry (desktop only) and after the
  invite sheet closes (won the focus race against Radix's trigger
  restoration).
- **Relay-offline strip**: "The line is down — letters pause until
  it returns." — strip-in/strip-out choreography, composer lock,
  auto-recovery verified with a full relay stop/start.
- **Unread counts**: persisted per room card, counts real letters
  only (joins/rejections stay dot-only), capped "99+", chip-pop
  entrance, reset on entry.
- **Two bugs caught by E2E before shipping**: an inverted
  `memberConnected` boolean that would have made the grace dead in
  production (the pure-function tests were right; only live E2E
  caught the adapter), and an init double-registration race
  (synchronous guard added).

---

## 6. Task 22 — security residuals, legal, brand, deploy

- **22-b Security residuals** (test-first, +18 tests): `POST /leave`
  now requires **proof-of-possession** — an ECDSA signature from the
  member's own room key over `cc-leave-v1:{roomId}:{memberId}:{ts}`
  (±10 min window; idempotent replay; already-inactive leaves don't
  bump the epoch). Per-IP rate limits on room-info (30/min),
  verifier (30/min), member joins (12/min), leave (20/min). Member
  cap became a **freshness-windowed soft cap** (15 min) centralized
  in `lib/admission.ts`. HKDF scalar range made an explicit tested
  invariant (`[1, n−1]` bigint check). DESIGN.md gained the
  localStorage residue inventory.
- **22-c Legal package**: MIT `LICENSE`; `public/legal/terms.md` (18
  sections) + `privacy.md` (14 sections) — factually tied to the real
  architecture (no accounts, immutable password, E2EE moderation
  reality, no destruction warranty, self-hosting = you are the data
  controller); `legal-sheet.tsx` renders them in-app (markdown over
  react-markdown, paper-styled) from the landing footer and Settings
  → About.
- **22-d Brand mark (v1)**: "The Split Seal" — wax seal with a
  diagonal fracture; superseded in Task 23 by the final mark (below).
- **22-a/e/f Deploy/CI/env layer**: the app became sandbox-independent
  — `deploy/` (multi-stage `Dockerfile.web`, `Dockerfile.relay`,
  `docker-compose.yml` with web + relay + Caddy auto-TLS and a
  `handle_path /relay/*` prefix-strip proxy, db volume),
  `.env.example` as the configuration contract, `NEXT_PUBLIC_RELAY_URL`
  env-driven relay URL, `.github/workflows/ci.yml` (install → prisma
  generate → lint → tsc → 92 tests → npm audit → production build),
  service-worker update flow (v3: one persistent "A fresh seal is
  ready" toast with a Reload action; never auto-reloads — drafts
  live in memory), OG/Twitter card metadata.
- Full two-origin golden-path E2E on the dev servers, including the
  new departure proof, rejoin-after-rotation, view-once file with
  caption, and burn on both origins.

---

## 7. Task 23 — The Vanishing Ink, room TTL, message TTL

- **Final brand mark**: the Split Seal was replaced by **The Vanishing
  Ink** — a hand-fallen ink drop whose top frays into three rising
  flecks, the last one ember-warm. `mark.tsx` exports `InkMark` with
  variants intact/scattered/fleck/ghost; ~15 call sites updated
  (typing dots are flecks, sender identities are flecks of the same
  ink in member colours, watermarks are drop ghosts); all PWA/apple/
  OG assets regenerated from the same geometry (`scripts/gen-icons.ts`
  is re-runnable).
- **Room TTL (creator-chosen)**: `Room.expiresAt` (nullable =
  until-burned); presets 24h/1h/7d/30d/Custom (5 min–30 d)/Until-
  burned; `PATCH /api/rooms/:id` (creatorToken-gated) adjusts later;
  lazy sweep of expired rooms on create; join/unlock surfaces say
  "This room's time ran out"; header countdown (terracotta under a
  minute); expiry watcher navigates out with a "Closed — its time ran
  out" ash-style card.
- **Message TTL (per message)**: presets gained 15s/30s/1m; custom
  editor (5 s–24 h, sec/min/hr units, live label); the composer's
  blind cycle button became a popover (desktop) / bottom sheet
  (mobile) with the same shared `TtlPicker`; messages burn with the
  ember choreography.
- `format.ts` learned sub-minute ("42s") and day-spanning ("3d 04h")
  countdowns.

---

## 8. Task 24 — the motion pass

- **Hero choreography** (landing): the drop falls (580 ms gravity,
  squash at impact), the three flecks splash upward (staggered), a
  soft ink halo bleeds outward beneath, then the evaporation loop
  takes over. Two animations, disjoint CSS properties, one element —
  the trick that makes it composable.
- Ghost watermarks **draw themselves** (normalized stroke-dash
  draw-on, 1.3 s) then drift almost imperceptibly (13 s ±6 px).
- Screen transitions (280 ms fade + rise); chat screens keyed by
  roomId (switching letters is switching pages); messages arrive
  from the side they were written on (self → from the right margin,
  others → from the left, one soft overshoot).
- Typing whisper: the writer's ink flecks rise and fade on a loop.
- TTL countdowns breathe in their final ten seconds; two flecks
  (forest + ember) rise from the send button as a letter leaves;
  the theme icon swings in on change.
- **Regression found & fixed**: TTL rooms' entry system line had
  killed both empty states (`messages.length === 0` was never true) —
  empty now means "no letters", with system lines rendered above.
- `devIndicators:false` (the Next dev badge overlapped the composer
  on small screens); every animation degrades under
  `prefers-reduced-motion`.

---

## 9. Task 25 — notifications, overlap fix, mobile shell

- **Notification engine** (`lib/notifications.ts`): preview
  preference content/sender/none (applies to both channels);
  channel decision — in the room → none, hidden/backgrounded →
  native, otherwise → in-app banner; truncated previews that never
  quote files; `setAppBadge`/`clearAppBadge` launcher badge sync.
- **The overlap fix, two layers**: (1) in-app banners are **in flow**
  — the app shell gained a sticky-top notice stack that opens a grid
  track (0fr→1fr, 360 ms) so the app *steps down*; nothing is ever
  covered. (2) Sonner toasts seat at `--toast-top = safe-area +
  64px + --cc-notice-h`, with a ResizeObserver publishing the
  banner height live — a toast can never land on the header or a
  banner.
- **NoticeStack + store/notices.ts**: one banner per room
  (replace-in-place, clock reset), max 3, 6.5 s auto-dismiss,
  two-step exit animation, focusable (Enter/Space → open room),
  `aria-live=polite`.
- **Native notifications round-trip**: `sw.js` gained
  `notificationclick` (focus existing client + postMessage
  navigation, else open the room deep link); `sw-register.tsx`
  routes the navigation in dev too while registration stays
  production-only.
- **App settings sheet**: a Notifications section walking all four
  permission states (Allow button / 3-option preview radio / 
  re-enable copy / banners-still-work copy) + an Install section
  (beforeinstallprompt captured; iOS 3-tap walkthrough).
- **PWA/manifest**: `display_override`, `launch_handler:
  focus-existing`, app shortcuts (New room / Your rooms).
- **iOS splash screens**: 13 per-resolution launch PNGs (105 KB
  total) generated by `scripts/gen-splash.ts` — the mark geometry is
  read from `logo.svg` at generation time (never re-drawn), and the
  composition positions are set by alpha-channel measurement, not
  eyeballing. `apple-splash.tsx` serves the links.
- **Capacitor scaffold**: `capacitor.config.ts` (remote-URL mode —
  the shell frames the deployed origin; TLS only) + `MOBILE.md`
  (PWA install path, the full `npx cap` pipeline, honest limits
  including why there is no web push by architecture, and the 4-step
  VAPID future-work sketch).
- Test count: **108/108** (16 new notification cases).

---

## 10. Task 26 — the password breach (user challenge)

User pasted the live DOM of the create-sheet password input
(`type="text"`, `value="quill-grove-harbor-orchard"`) and asked to
find the breach. Three layers found and fixed:

1. **CRITICAL — the generator drew from `Math.random()`** (V8
   xorshift128+, predictable). `lib/identity.ts` rewritten: a
   **256-word list** in the app's stationery/nature voice, sampled
   via `crypto.getRandomValues` with rejection-guarded unbiased
   sampling (one byte = one word at list size 256, zero modulo
   bias; duplicates skipped).
2. **CRITICAL — 18 bits of keyspace** (24 words, 4 picks). Raised to
   **5 words = 2^40 candidates** — the public verifier oracle moves
   from an afternoon to a multi-year grind through argon2id.
3. **Input hygiene**: `autocomplete="off"` → `"new-password"` (the
   documented suppressor of Chrome's save-password prompt for
   ephemeral room passwords); the reveal toggle became
   keyboard-focusable with `aria-pressed`; plaintext state now
   clears the moment its job is done (create sheet, join, unlock,
   invite). The memory-only session retention stays, documented and
   deliberate (the invite sheet re-shares the password; legacy v1
   epoch re-derivation needs it).
- DESIGN.md gained the "Room passwords" bullet stating all of this,
  including the inherent limit.

---

## 11. Task 27 — the DevTools value-attribute fix (user challenge)

User: *"while typing using DevTools, in sensitive fields like
passwords, the `value=""` tag always reveals it. Can't that be
hidden or removed?"*

- **Diagnosis**: React controlled inputs mirror every keystroke into
  the DOM `value` **attribute** (visible in Elements), and the
  plaintext also sat in React state (readable in React DevTools).
- **Fix — `PasswordField` became the uncontrolled secret field**:
  props now `Omit<InputHTMLAttributes, "value" | "defaultValue">` —
  a **compile error** to pass either. The attribute is never
  written; no plaintext ever sits in React state. Parents
  seed/wipe imperatively through the forwarded ref (`el.value = …`
  sets the property only) and read once at submit.
- **All four consumers migrated**: create sheet (landing), join form
  (invite), locked-room view (chat), unlock sheet (room-list) — each
  reads the ref at submit and wipes on success/close/unmount.
- **Subtle bug found during QA and fixed**: the create-sheet seed
  effect initially lived on the parent — but Radix `Presence` mounts
  portal children in a **later commit** than the parent's open-state
  change, so it fired before the input existed. Fix: `SeedPassphrase`,
  a render-null component *inside* the portal content whose mount
  effect seeds the field exactly when it comes to life (and re-runs
  on every reopen).
- **Unrelated real bug found & fixed — the permanent offline state**
  visible in the user's screenshot: `.env` was missing
  `NEXT_PUBLIC_RELAY_URL`, so clients fell back to `/relay/`, which
  the sandbox gateway does not forward → every room showed "The
  line is down" forever. `.env` now carries the sandbox value
  `/?XTransformPort=3003`; verified live (composer enables,
  messages relay end-to-end).
- Verified: `getAttribute('value') === null` at every step of every
  flow — seeded, toggled, typed-into, reseeded, submitted, unlocked.
  The honest limit stands in DESIGN.md: the DOM `value` *property*
  is always readable from the user's own machine — that is true of
  every site, and the page must read the secret to encrypt with it.

---

## 12. Round 29 — quoted replies + in-app media viewers

Two features landed together because they touch the same seam: what
a message can point at, and what opening a message means.

### 12.1 Quoted replies to specific messages

- **`src/lib/types.ts`** — new `ReplySnapshot` interface
  `{id, senderId, snippet, file?}`; `REPLY_SNIPPET_MAX = 120`;
  `makeReplySnapshot()` builds the quote at reply-compose time — **view-once
targets are quoted as "Sealed message"**, never by their contents (the
sealed card's own rule: nothing shows before opening); file targets quote
the file's name and carry `file: true`; text targets are
whitespace-collapsed and capped at the first 120 characters.
  `sanitizeReplySnapshot()` is the post-verification UI gate (id/senderId
capped at 64 chars, snippet at 160, malformed shapes dropped — a failing
snapshot renders the message unquoted, never broken);
  `isReplySnapshot()` is the shape guard used on both sealing and
verification. `MessageView` gained `replyTo?: ReplySnapshot`.
- **`src/lib/protocol.ts`** — `FrameBody.reply?: ReplySnapshot`; new exported
  `replyCanonical()` serialises the snapshot deterministically
  (unit-separator-joined slots — the separator is cosmetic, slot order is
  what binds); **`canonicalV2` now appends the replyCanonical component as a
  12th field** — the quote is signature-covered, so a quote is exactly as
  unforgeable as the words it carries; a tampered quote breaks the ECDSA
  signature. `sealFrame` extracts and includes it.
- **`src/lib/room-protocol.ts`** — `sealText`/`sealFile` accept `reply`; the
  file-assembly map stores it; the completed-file OpenResult carries it;
  and `open()` verifies with the **raw** reply before any sanitising —
  verification must recompute the sender's exact canonical string, not a
  cleaned-up one.
- **`src/store/app.ts`** — `sendMessage(text, file?, ttlOverride?, reply?)`;
  the optimistic view carries `replyTo`; both receive paths (text frames and
  file-assembly completion) sanitise for the view, after verification.
- **UI, `src/components/cc/bubble.tsx`** — `QuoteBlock`: ink-coloured left
  border in the **quoted** sender's ink (`var(--ink-N)`, "Someone" in mute
  once they leave), alias + snippet, a `FileText` glyph for file quotes;
  click → jump to the original (`scrollIntoView` center) with a
  `quote-flash` soft forest pulse in `globals.css` (1300ms, once;
  reduced-motion: static 8% tint); the honest toast "That message is no
  longer in this session" when the original burned or expired. Reply
  affordances, three roads to one verb: the context menu's "Reply" item
  (press-and-hold on touch), a hover-only reply icon button beside the
  bubble on desktop (`group/row` opacity transition, `-left-10` for self /
  `-right-10` for others), and double-click on the bubble. Every message row
  carries `data-mid` for jump targeting.
- **UI, `src/components/cc/composer.tsx`** — the reply slip above the input
  (quote + X to cancel); the input is focused when a reply begins (touch
  included — the reply IS an intent to write); submit seals the snapshot
  into the message; **Escape while replying cancels the quote first**, with
  `stopPropagation` so the window-level escape-to-rooms handler doesn't
  fire.
- **UI, `src/components/screens/chat.tsx`** — `replyTarget` state (cleared on
  room switch and when the target burns — render-time adjustment pattern);
  `jumpToMessage` with `CSS.escape` + flash restart (class remove → reflow →
  add, so repeated jumps re-announce); viewer and reply both follow their
  message out when it burns.
- **Honest failure mode, chosen deliberately**: a mixed-version session — an
  old tab running pre-reply code beside a new one — will **drop** new reply
  frames rather than accept a quote it cannot verify. The letter is lost
  for that tab, never forged.

### 12.2 In-app viewers for ALL media (no forced downloads)

- **`src/components/cc/file-viewer.tsx` REWRITTEN** — exported
  `classifyFile(mime, name)` routes by mime + extension to
  image | video | audio | pdf | text | csv | binary. All bytes decode once
  to memory and render through **revocable blob: URLs** — created in an
  effect keyed on the message id, revoked on switch/unmount. Nothing is
  fetched; nothing is written.
- **Viewers per type**: images with click-zoom (unchanged behaviour, now fed
  from the blob); `<video controls playsInline
  controlsList="nodownload noremoteplayback">` (PiP disabled and contextmenu
  suppressed for view-once); a styled `<audio>` card with the same
  controlsList; **PDFs render via pdfjs-dist v6 onto a `<canvas>`**
  (`bun add pdfjs-dist`; worker copied to `public/pdf.worker.min.mjs`,
  served from `/pdf.worker.min.mjs`) with devicePixelRatio scaling (capped
  2×), fit-width, Back/Next page nav and "Page x of y" — canvas rendering
  means **no browser PDF toolbar, no save button**. pdf.js transfers
  buffers, so it is handed `bytes.slice()` — a copy. If pdf.js fails to
  load: regular files fall back to an `<iframe>` with the blob URL
  (honest), but **view-once files STAY SEALED** — falling back would expose
  the browser PDF toolbar's save button, and the notice says so. Corrupt
  PDFs set a failed state rather than showing a blank canvas. Teardown is
  hardened the same way: a `destroy()` that races an in-flight load
  rejects its own promise, and both the cancelled branch and the effect
  cleanup swallow that expected refusal (`.catch(() => undefined)`) —
  closing the viewer mid-load raises nothing, not even an unhandled
  rejection. Text files
  render as escaped plain text in a monospace `pre` (React escaping — never
  innerHTML) with a wrap toggle and a 100 KB display cap
  (`TEXT_SHOW_MAX = 100_000`; "copy takes the whole file"); HTML is labelled
  "Shown as source — HTML is never executed here"; **SVG only ever rides an
  `<img>`**, the context where its scripts cannot run. CSV parses via a
  quote-aware RFC-4180-style `parseCsv()` (pure, exported, tested) into a
  sticky-header table capped at 500 rows × 32 cols (`CSV_MAX_ROWS` /
  `CSV_MAX_COLS`). Unknown binaries get a metadata card + a hex dump of the
  first 512 bytes.
- **Header & buttons** — name · size · mime; Copy contents (text-ish — the
  whole file); Download, present ONLY for non-view-once files; Close.
  **View-once files have NO download anywhere** — the explicit note reads
  "View once — it lives on screen only. There is no download for this file,
  from anyone, by design."
- **`src/components/cc/bubble.tsx` FileContent** — ALL non-view-once file
  cards now OPEN THE VIEWER (Eye glyph) instead of downloading directly;
  video cards (Film icon) and audio cards (Music icon) carry kind labels;
  download is a choice inside the viewer, never the card's whole job.
- **`src/components/screens/chat.tsx`** — the viewer closes when the message
  burns while open (render-time adjustment).
- **`eslint.config.mjs`** — `"public/**"` added to ignores (the pdf worker
  is a vendored minified asset, not our code to lint).

### 12.3 Tests and QA

- **Tests** (`src/lib/__tests__/task-29-replies.test.ts`, 16 new cases;
  suite now **124**): reply round-trip on text and through file assembly;
  a relabeled frame is rejected; a reply frame is size-indistinguishable
  from plain text (uniform `CONTROL_FRAME_BYTES`); replay refusal;
  `replyCanonical` determinism and shape-guarding; a direct ECDSA proof
  that changing the quote breaks the signature; `makeReplySnapshot`
  (truncation, file label, sealed-for-view-once); `sanitizeReplySnapshot`
  caps/drops; `classifyFile` routing; `parseCsv` (quotes, commas,
  newlines, CRLF, single-column).
- **E2E QA (verified, two browser sessions through the gateway
  127.0.0.1:81, room CMJ1NT8144)**: reply sent via the hover button — quote
  block rendered on both sides with the correct alias/snippet; quote click
  jumped + flashed; context-menu Reply worked; Escape cancelled the reply
  without leaving the room; a reply to a spent sealed message quoted
  "Sealed message". Viewers: text (pre + copy + download), CSV table
  (header + 3 rows), audio (blob src + nodownload controlsList), video (a
  real 2s mp4 played, readyState 4), PDF rendered on canvas at desktop and
  390px mobile ("Page 1 of 1", ~563 text pixels painted), and a
  deliberately corrupt PDF fell back to the iframe (non-view-once path
  verified). View-once file: opened with content, NO download button, the
  by-design note present, and the spent card propagated to both sessions.
  Consoles clean (in-page error listeners: zero errors), dev.log all
  200/201. VLM review of the desktop room, video viewer and mobile PDF
  screenshots: clean. tsc clean, eslint 0 errors, 124/124 tests.
  (Operational note for anyone re-verifying: every session must run on
  the **gateway origin** — `127.0.0.1:81` — because the dev relay URL
  routes through `XTransformPort`; a tab opened on `localhost:3000`
  has no relay route and sits permanently offline.)

---

## 13. Round 30 — documentation sync + viewer state hygiene

### 13.1 The lint investigation

- Verifying this document's "lint clean" claim surfaced **one warning**
  the Round 29 ship had left behind: an unused `eslint-disable-next-line
  react-hooks/exhaustive-deps` in `file-viewer.tsx`. The forensic
  surprise: the directive was **dead weight for the rule it names**
  (`exhaustive-deps` is `"off"` in `eslint.config.mjs`, so it suppressed
  nothing) yet **load-bearing for a different one** — Next 16 ships the
  compiler-era `react-hooks/set-state-in-effect`, and the react-hooks
  plugin treats `exhaustive-deps` disable comments as the sanctioned
  escape hatch for those rules as well. Remove the comment and two very
  real errors appear (one per effect: the zoom/wrap reset and the blob
  effect's clear-branch); keep it and eslint reports the directive as
  unused. A directive that silently suppresses a rule it doesn't name
  is a trap for every future reader — including the one who "cleans it
  up".

### 13.2 The fix — sanctioned patterns, precisely

- **`src/components/cc/file-viewer.tsx`** — the two reset-on-message-
  change effects (the zoom/wrap reset; the bytes/blobUrl clear) became
  a single **guarded render-time adjustment** keyed on a new `viewingId`
  state — the same pattern `chat.tsx` already uses for reply/viewing
  release: no effect, no cascading render, and a departing file's
  plaintext is dropped from state the instant it is no longer the file
  on screen (a small memory-hygiene win: the clear now happens at
  render, not after). The blob effect keeps purely external-system
  work — mint the object URL, revoke it in cleanup — plus the one
  synchronous setState that stores the created handle, which carries a
  single-line `eslint-disable-next-line
  react-hooks/set-state-in-effect` with the reason written in the
  comment above it: the rule's heuristic has no shape for "an effect
  creates an external resource and remembers the handle". The disable
  names the rule it actually silences, so eslint counts it as used and
  stays quiet — nothing is suppressed by accident any more.
- **`COMPONENTS.md`** — the FileViewer "Blob lifecycle" paragraph gained
  the render-time-adjustment sentence, so the reference matches the
  code exactly.

### 13.3 Verification

- lint **0 errors, 0 warnings** — the first fully clean run since the
  compiler-era rule arrived; tsc clean; the suite untouched at 124/124.
- E2E re-verification of the whole viewer matrix through the gateway
  (room NQ2A98B4CA): the text file renders its contents; the CSV parses
  into a 3-row sticky-header table; the image viewer feeds from a
  `blob:` URL and zoom toggles (`cursor-zoom-in` ↔ `cursor-zoom-out`);
  a zoomed image, closed and replaced by the text file, re-derives
  everything with defaults restored (the adjustment reset, the effect
  rebuilt); a view-once file opens with content, **zero download
  buttons**, the by-design note, and the spent state propagates. Zero
  page errors, console clean, dev.log all 200/201.

---

## 14. Round 31 — the last mile (deploy-gate work)

The round the analysis asked for: every claim becomes true of the
artifact users will actually touch. Four of the six items are shipped
and verified; the two that require leaving the sandbox (a real CI run
on GitHub, a Docker-host compose E2E) are prepared and honestly
stated as the remaining distance.

### 14.1 CI gate (31.1)

- **`next.config.ts`**: `typescript.ignoreBuildErrors` **removed** — the
  Docker image's `next build` can no longer carry what CI's explicit
  `tsc --noEmit` exists to catch. The artifact and the gate can no
  longer diverge.
- **Cold-runner simulation** of `.github/workflows/ci.yml` in the
  sandbox: `bun install --frozen-lockfile` class ✓, `prisma generate` ✓,
  lint ✓ (0/0), `tsc --noEmit` ✓, the property suite ✓ (139/139). The
  build step is the one thing the sandbox cannot run (the dev server
  owns `.next`); the first real Actions run is the proof that remains.
- **The audit gate fired for the first time — and it is RED.** The
  simulated `npm audit --audit-level=high` (the CI step) found
  **32 vulnerabilities (2 critical, 17 high)** in the tree. `bun
  update` (semver-range fixes only, 171 packages) cleared both
  criticals and 7 highs → **25 remaining (0 critical, 14 high)**, with
  the suite staying green throughout. The remainder needs deliberate
  work, not `--force`: npm's suggested prisma "fix" is a *downgrade*
  (6.19.2 → 6.12.0 — backwards), `@mdxeditor` needs a major bump, and
  the rest are dev-chain transitives (lodash/brace-expansion/minimatch/
  js-yaml/picomatch class) that never ship in the standalone build.
  This is the debt a never-fired gate was hiding, now named.
- **A real bug the update surfaced and fixed**: `bun update` desynced
  React (19.2.3) from react-dom (19.3.0) — the dev server served a
  blank page with "Incompatible React versions". Both pinned to
  **19.3.0**; dev server restarted; full golden path re-verified
  (create room, six-word passphrase, send, deliver, zero page
  errors).

### 14.2 Compose stack audit (31.2)

- **The suspected deploy-completeness bug is a false alarm — and the
  record's own wording was the culprit.** The compose stack DOES carry
  the presence service: the relay container `expose`s both `3003`
  (socket.io) and `3004` (internal presence), and the web tier's
  `RELAY_PRESENCE_URL: http://relay:3004` points at it. The presence
  snapshot is **the same relay process on a second port**, not a
  missing third service — but CHANGES.md's inventory line ("relay
  :3003 · presence snapshot :3004") read like two services and misled
  the analysis. The inventory and DESIGN.md now say it plainly.
- `grep src/` for `XTransformPort` / `localhost:81` / `127.0.0.1:81`:
  **nothing** — no gateway hardcodes in the shipped code.
- **Docker is not available in this sandbox** — the compose E2E
  (deferred Task 20 acceptance) still requires a Docker host and is
  the honest remaining distance, stated in the residuals.

### 14.3 EXIF stripping — the privacy obligation (31.3)

- **`src/lib/media.ts` (new)** — `imageNeedsScan(mime)` scopes the
  pipeline to jpeg/png/webp (SVG and GIF pass through by policy: SVG
  has no EXIF and is never rasterised — its scripts die in the img
  context; GIF's surface is comment-only and a re-encode would kill
  animation). `imageHasMetadata(bytes, mime)` is a **pure, byte-level
  detector**: JPEG walks its marker segments (APP1 Exif, APP1 XMP,
  COM free-text, with FF-fill-byte tolerance; SOS ends the scan), PNG
  walks its chunk table (eXIf/tEXt/iTXt/zTXt/tIME), WebP walks RIFF
  chunk fourccs (EXIF/XMP); unparseable image bytes flag **suspect** —
  the detector fails toward the strip. `reencodeImage(file)` is the
  browser half: decode (createImageBitmap, `<img>`+object-URL
  fallback) → canvas → encode (JPEG/WebP q0.92, PNG lossless), null on
  any failure.
- **`composer.tsx` `pickFile`** — images are scanned before attaching:
  clean files pass through untouched (no cost, no quality loss);
  metadata-carrying files are re-encoded and it is the **re-encoded
  bytes that seal** — the attachment slip shows the new size, so what
  you see is what you seal. **Fail-closed**: a metadata-carrying image
  that cannot be re-encoded (or outgrows the limit) is refused with
  "This image carries hidden metadata we couldn't strip — it wasn't
  attached." — never a silent send of location data.
- **Verified end-to-end** (gateway, room EMH0P11JA2): a GPS-tagged
  JPEG (a real ffmpeg JPEG with a hand-built EXIF APP1: TIFF IFD0 →
  GPS IFD, lat 6°30'30.5"N lon 3°12'15.2"W) attached at 739 B → the
  slip showed the re-encoded 1 KB → sent → the viewer's blob fetched
  and byte-inspected: **JPEG with no "Exif" APP1, no XMP, no comment,
  decoding at full 280px width**. A clean PNG passed through
  byte-identical (264 B → 264 B) and displayed. Even the ffmpeg base
  JPEG's "Lavc61.19.101" COM comment was correctly flagged — the
  detector catches encoder fingerprints, not just GPS.
- DESIGN.md §5 carries the full policy + the cost note (one-time
  decode+encode at attach, imperceptible for photos).

### 14.4 Passphrase default: six words, 2^48 (31.4)

- **`identity.ts`**: `generatePassphrase(words = 6)` — the 256-word
  CSPRNG generator's default raised from 5 to 6 words. Arithmetic,
  stated honestly in DESIGN.md §5: 5 words (2^40) survived a laptop
  but a ~100-GPU cluster grinds it in *months*; 6 words (2^48)
  multiplies the grind by 256× — multi-year even for a large cluster.
  Same UX class: still typeable, still stationery-voiced.
- **Tests** (`task-31-last-mile.test.ts`): default = 6 distinct
  in-list words; explicit counts honoured; **the CSPRNG-source proof**
  (a deterministic `getRandomValues` stub makes the output predictable
  to the byte — the words derive from CSPRNG bytes and from nothing
  else, with `Math.random` spied to zero calls); `PASS_WORDS` exactly
  256 unique (the invariant unbiased sampling stands on); 50-sample
  distribution sanity. `PASS_WORDS` is now exported for exactly this.
- **Verified in the browser**: the create sheet seeded
  "pillow-bison-topaz-vellum-peony-lichen" (and later
  "teak-ravine-indigo-canvas-radish-magnet") — six words, unlock
  round-trips through argon2id on the new format.

### 14.5 Canonical versioning — the proof, and the fix it forced (31.5)

- **The unasked question had the bad answer.** Round 29's
  `canonicalV2` **always** joined twelve fields — `replyCanonical(
  undefined)` returns `""`, so every plain frame's canonical ended with
  a trailing `|` the Task-19 eleven-field form never had. A pre-reply
  frame would **not** have verified under the shipped verifier: every
  deploy would have silently dropped messages from not-yet-reloaded
  tabs, in both directions, for the whole mixed-version window.
- **The fix — made free by the fact that nothing has ever deployed**:
  the reply slot is now appended **only when a quote exists**
  (`return reply ? base + "|" + reply : base`). A plain frame's
  canonical is byte-identical to the pre-reply form; a valid snapshot
  never serialises to `""`, so "no reply" and "shape-guard-failed
  reply" remain the same string, and a tampered reply still changes
  the canonical (which is what breaks the signature).
- **The proof** (`task-31-last-mile.test.ts`): the test builds the
  Task-19 eleven-field string by hand, signs it, and verifies it
  under the current `canonicalV2` — **and the mirror direction too**
  (a new plain signature verifies under the old canonical). The
  rollout is now clean both ways: only a letter that actually carries
  a quote needs both ends current, and an old tab drops exactly those
  (documented since Round 29). DESIGN.md's Quoted-replies entry
  records the refinement.

### 14.6 The abuse surface (31.6)

- **`POST /api/rooms/:roomId/report`** (`src/app/api/rooms/[roomId]/
  report/route.ts`) — the one act of moderation the architecture
  permits: terminate the room. Burns it in the registry (members
  deleted, verifier withdrawn, `burnedAt` set), stores a capped
  (500-char) `reportReason` for operator forensics, then tells the
  relay. **5/min/IP** rate limit; unknown and already-burned rooms
  answer `{ok: true}` exactly like success — existence is never
  confirmed to strangers, same as `/evict` and `/burn`.
- **Relay `POST /terminate/:roomId`** on the internal :3004 port
  (token-guarded, never gateway-routed): emits `room:burned` to every
  connected member and drops the room — the event every client
  already runs its burn sequence on. `terminateRoom()` extracted so
  the socket `room:burn` path and the internal path share one body.
- **Schema**: `Room.reportReason String?` (pushed).
- **The contact**: `abuse@cipherchat.app` in README (new "Reporting
  abuse" section with the same ceiling honesty) and in Settings →
  About (Flag glyph, click-to-copy with "Address copied" toast, and
  the quiet line "Reporting ends the room — it cannot unsend anything,
  because nothing is kept."). DESIGN.md §6 states the ceiling as a
  threat-model line: anyone who knows a room ID can end it — the same
  griefing ceiling a leaked creator token already had.
- **Verified end-to-end** (room EMH0P11JA2, member connected through
  the gateway): report via curl → `{ok: true}`; relay logged "room
  EMH0P11JA2 terminated (internal)"; the connected member's client ran
  the full burn sequence (navigated to `#/rooms`, room gone from the
  list); DB: `burned: true`, reason stored, 0 members, verifier null;
  unknown room → `{ok: true}`; already-burned → `{ok: true}`; the
  5/min window edge → **429** on the sixth call. (The sandbox `.env`
  gained a real `RELAY_INTERNAL_TOKEN` + `RELAY_PRESENCE_URL` for
  this — the same vars compose already wires.)

### 14.7 Round 31 tests + verification

- `src/lib/__tests__/task-31-last-mile.test.ts` — 15 cases: the
  canonical versioning proof (3), the passphrase generator (4), the
  metadata detector (8: JPEG EXIF/XMP/COM/clean + FF-fill, PNG
  eXIf/text/clean, WebP EXIF/clean, suspect-on-garbage, scope). Suite
  **124 → 139**, all green.
- lint 0 errors 0 warnings; tsc clean; browser E2E green through the
  gateway (EXIF strip, clean passthrough, six-word passphrase,
  Settings About copy, report + burn propagation + rate limit);
  dev.log all 200/201/429-as-designed; zero page errors.

---

## 15. Current state inventory

**Tests:** 139/139 across 15 files (replay, rotation, kdf, identity,
padding, hardening, captions, reactions, silent-grace, leave-proof,
identity-range, admission, notifications, replies + viewer/CSV
parsing, last-mile: canonical versioning proof + passphrase
generator + image-metadata detector).
Lint clean (0 errors, 0 warnings); tsc clean in src/.

**Services:** Next.js dev `:3000` · relay `:3003` (socket.io,
in-memory, supervised) — **the same relay process also serves the
internal presence snapshot on `:3004`** (token-guarded, plus
`POST /terminate/:roomId` since Task 31; never gateway-routed) ·
gateway `:81` (Caddy, `XTransformPort` routing).

**Docs:** `README.md` (product + honest NOT-protect list + running
it + reporting abuse) · `DESIGN.md` (tokens, motion vocabulary,
architecture §5, threat model §6) · `COMPONENTS.md` (full
component/behavior reference) · `MOBILE.md` (PWA + Capacitor +
honest limits) · `LICENSE` + `public/legal/` (MIT, Terms, Privacy) ·
`worklog.md` (this history's raw source).

**Deploy:** `deploy/` (docker-compose: web + relay — both ports —
+ Caddy TLS, `.env.example` contract) · `.github/workflows/ci.yml`.

**Known residuals (documented, not hidden):** the last mile itself —
**a real CI run on GitHub Actions has still never fired** (the
sandbox simulated every step it can: lint/tsc/tests green, but the
push and the build step need the repo), and **the audit gate is
red**: 25 advisories remain (0 critical, 14 high) after the semver
`bun update`; the fix paths are deliberate work, not `--force`
(prisma's listed fix is a downgrade, @mdxeditor needs a major bump,
the rest are dev-chain transitives that never ship in the standalone
build). Compose E2E still needs a Docker host. No web push by
architecture (VAPID sketched in MOBILE.md with its privacy price);
evict trusts the relay's in-memory clock; nuisance-eviction residual
(and its sibling: anyone who knows a room ID can report-terminate it
— stated as a threat-model ceiling, Task 31); replay-to-fresh-device
within 10 min. From Round 29: a reply's quote deliberately survives
its original burning (the words were already shown; burning quotes
with their original is a one-line policy flip if that ever feels
wrong); video and audio cards are icon cards, not frame previews
(canvas frame-capture is possible but adds decode cost); the vendored
pdf.js worker is ~1.3 MB (accepted, documented, lazy-loaded). Closed
in Round 31: EXIF (scan + canvas re-encode at attach, fail-closed),
the 5-word passphrase (now 6, 2^48), the canonical versioning gap
(plain frames are byte-identical to the pre-reply form — proven both
directions), and the abuse surface (report endpoint + relay
terminate + abuse@ contact).
