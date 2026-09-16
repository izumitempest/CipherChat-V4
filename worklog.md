# CipherChat — Worklog

---
Task ID: 0
Agent: lead (Z.ai Code)
Task: Master plan for CipherChat — end-to-end encrypted, ephemeral messaging app (warm paper/forest aesthetic, NOT cyber/hacker)

Work Log:
- Explored scaffold: Next.js 16 + Tailwind 4 + shadcn/ui (new-york) + Prisma/SQLite (db/custom.db) + zustand + framer-motion + socket.io example pattern (path '/', XTransformPort query via Caddy gateway)
- Socket pattern confirmed: server on separate port (3003) with `path: '/'`; client `io('/?XTransformPort=3003')`
- DATABASE_URL=file:/home/z/my-project/db/custom.db

Stage Summary — ARCHITECTURE DECIDED:
- Single user-visible route `/` → client-side hash router (#/, #/join/:id, #/rooms, #/r/:id). Invite links use `/?join=<roomId>`.
- REAL crypto in browser: room key = PBKDF2-SHA256 (750k iter, salt `cipherchat:v1:<roomId>:<epoch>`) → AES-GCM; per-device ECDSA P-256 signing keypair in localStorage; messages signed inside encrypted payload; forged messages (bad signature) → quiet system rejection line.
- Verifier blob (encrypted known plaintext) stored on room → wrong-password detection without server knowing password.
- Epoch-based key rotation when a member leaves (server bumps epoch; clients re-derive from in-memory password, quiet "Re-sealing…" state).
- Server = blind relay: REST (room lifecycle, member registry for fingerprints) + socket.io mini-service :3003 (in-memory presence, message relay, view-once spent, burn announce). NO message persistence — new joiners see no history by design.
- Refresh = keys wiped (memory only) → rooms lock. Room list from localStorage. Locked unlock → S3 sealing → chat.
- Identity: deterministic alias (adjective+animal, e.g. "Quiet Heron") + muted ink color from fingerprint of signing pubkey. 8 curated muted inks (no red/terracotta hues).
- Design system: Lora (human voice: messages, names, headings) + Inter (machine voice: chrome/labels/meta) + IBM Plex Mono (fingerprints). Tokens light: paper #F4F1EB / paper-side #EBE7DF / charcoal #2C2A28 / forest #3A4F41 / terracotta #C85A40 (destructive+impermanent ONLY) / ember #E8A87C (motion only). Dark "Nightfall": #18181B-family base, warm low-contrast surfaces.
- Only security glyph = shield (S7). No padlocks... EXCEPT locked-room state uses a lock glyph per S4 spec (lock = locked room state, distinct from security badge). Zero exclamation marks in copy. Errors neutral charcoal.
- Files: ≤2MB, encrypted in payload; view-once = sealed card → spent card w/ ember edge, non-reopenable.
- Planned tasks: 1 design foundation / 2 backend / 3 client libs / 4 screens / 5 integration / 6 QA / 7-a polish subagent / 7-b re-verify / 8 deliverables+cron.

---
Task ID: 1, 2, 3, 4, 5 (partial)
Agent: lead (Z.ai Code)
Task: Design foundation, backend, client libs, all screens, integration

Work Log:
- globals.css: full token sheet (Daylight desk + Nightfall), Lora/Inter/Plex Mono via next/font, grain overlay, motion keyframes (breathe/settle/rise/seal-arc/seal-press/msg-burn/char-close/ember-rim/burn-line-in/burn-out), reduced-motion overrides (150ms fades, mandatory), bubble materials, quiet scrollbars, warm overlays
- Prisma: Room (id/verifier/creatorToken/epoch/burned) + Member (pubkey/alias/colorIdx/active, unique [roomId,pubkey]) — pushed to SQLite
- API: POST /api/rooms, GET /api/rooms/:id, PUT verifier (set-once), POST/GET members (cap 12, upsert by pubkey), POST leave (epoch bump = key rotation), POST burn (creatorToken)
- Relay mini-service :3003 running (bun --hot): room:join/message:send/message:spent/member:leave/room:burn; in-memory presence; blind — no DB, no message storage
- Client libs: crypto.ts (PBKDF2 750k → AES-GCM; ECDSA P-256 device keys in localStorage; canonical signing; verifier blobs), identity.ts (wordlist aliases, 8 muted inks, fingerprint 8-hex grouped, passphrase gen, room-code parser), session.ts (memory-only keys/passwords — refresh locks rooms), local.ts (desk cards, verified marks, per-room settings), relay.ts (single socket, XTransformPort=3003), format.ts
- store/app.ts: zustand orchestrator — hash router (#/, #/join, #/rooms, #/r/:id), createRoom/joinRoom/unlock flows with S3 sealing (min 1.7s theater + real derivation), send pipeline (sign inside encrypted payload), receive pipeline (decrypt → registry lookup → verify → reject on bad signature), TTL burn scheduling, view-once spend, epoch re-derivation on member:left ("Re-sealing"), burn choreography, presence, unread dots
- Screens: S1 landing (+create sheet w/ passphrase gen), S2 invite (prefilled code, wrong-password neutral errors, disclosure, all reasons), S3 sealing overlay (arc + press), S4 room list (locked cards w/ lock glyph, unlock sheet, ash state, empty desk), S5 chat (header w/ single shield glyph, grouped bubbles w/ corner rules, file cards, sealed/spent view-once, composer w/ TTL cycle + attach + view-once toggle + Reconnecting/Re-sealing states), S6 burn overlay (char-in 2s → Lora line → fade), S7 verification (fingerprints computed from pubkeys, copy, verify marks, glossary), S8 empty states (joiner + creator variants), S9 settings (local name, default TTL segmented, members, burn → centered consequence dialog)
- PWA: manifest + icons (sharp from SVG seal)
- lint clean; dev server compiles / with 200

Stage Summary:
- All S1–S9 implemented with real browser crypto; server is blind relay
- Remaining: browser QA (Task 6), polish pass (7-a/7-b), deliverables + cron (8)

---
Task ID: 6
Agent: lead (Z.ai Code)
Task: QA via agent-browser — golden path, two-member E2E, responsiveness, dark mode

Work Log:
- Full E2E through gateway (localhost:81, as preview panel does): landing → create room (passphrase gen, S3 sealing theater) → invite link → second session joins → bidirectional E2E messaging with signature verification
- Fixed bugs found by QA:
  1. member:joined broadcast lacked pubkey → receivers rejected all messages as "signature invalid" (relay now carries JWK; store emits it)
  2. rejoined flag always true → "X returned." on first joins (now flows from REST upsert)
  3. message:ack now room-scoped
  4. Composer TTL chip was cosmetic — sendMessage used room default (now ttlOverride param)
  5. zustand `?? []` selectors → getSnapshot infinite loop (stable EMPTY constants)
  6. creatorToken was memory-only → creator couldn't burn after refresh (now device-local like signing key)
  7. #/ always redirected to rooms when rooms exist → landing unreachable (added explicit #/new)
  8. ash card never displayed — loadRoomCards filtered burned on every call (sweep now happens once at page load)
  9. ChatScreen stale locked view after unlock from direct URL (subscribes to messages slice now)
- Verified: wrong-password neutral errors, locked cards + unlock sheet + S3, TTL countdown + 600ms burn + removal (tested w/ temporary 10s step, reverted), view-once sealed→open→spent-for-everyone, fingerprints MATCH across clients (EEBE·329E both sides), verify marks, local room names differ per member (Kyoto planning vs Room SDYP) and app never corrects, settings default TTL segmented, burn: consequence dialog → 2s char + ember + grain → Lora line → desk with one-session ash card → gone after reload, mobile 390px layout, dark nightfall, relay outage → "Reconnecting" chip → auto-reconnect + rejoin
- VLM design review round 1 (9/9/8/8): fixed seal mark ticks (read as crosshair → concentric wax seal), sidebar "New room" green → quiet icon button (one green per screen), burn enriched w/ terracotta-tinted char gradient + stronger ember rim + charred grain texture; regenerated PWA icons
- lint clean, no page errors, relay + next dev both running

Stage Summary:
- All S1–S9 states browser-verified end-to-end with real two-member crypto
- Remaining: 7-a polish subagent, 7-b re-verify, 8 deliverables + cron

---
Task ID: 7-a
Agent: frontend-styling-expert
Task: CipherChat styling polish pass (5 files)

Work Log:
- landing.tsx — tightened hero rhythm (seal→headline mt-7, headline→actions mt-9, quiet escape mt-5); deliberate focus-visible rings on CTAs (outline-hidden + ring-2 forest/40 with paper offset; forest/25 on QuietAction — the global outline was near-invisible on the forest primary); short-screen handling via [@media(max-height:720px)] (main py-9, footer pt-8→pt-5) so trust copy stays placed without crowding the fold
- room-list.tsx — card hover = subtle paper lift (hover:-translate-y-px + border-forest/25 + bg-wash, no shadows) that settles back on active; "New room" button matches the hover language + press-in; locked cards sleep (no lift, hover border-forest/15 + bg-wash/50, meta text-mute/75, lock glyph /60); unread dot seated on the name's x-height center (translate-y-px); ash card gets a quiet diagonal strikethrough (−2° ash/50 line across the name) + reduced contrast (meta /70, mail glyph /50)
- composer.tsx — textarea gains transition-colors 150ms (focus ring fades like every field) and loses the conflicting self-center so attach/TTL/send bottom-align with the last text line as it grows; disabled dimming standardized to opacity-50 everywhere (matches actions/fields) + cursor-not-allowed on the textarea; TTL chip rounded-[6px] with hover borders (forest/25 idle, terracotta/60 armed); send button gets the same focus-visible ring as landing CTAs; attachment slip restyled with a paper icon tile (size-8, mirrors file-card language), rounded-[10px], view-once chip hover borders + 44px hit area, X button hover:bg-wash
- bubble.tsx — sender-alias row spacing stabilized (mb-1.5 + leading-[18px], ink dot optical nudge); meta row mt-1.5 + whitespace-nowrap + tabular-nums so time and the ticking TTL countdown stay aligned without width jitter; system lines py-2.5 for even rhythm between groups; file cards: press-in on active, unified w-[230px], download glyph brightens on hover, sealed/image cards get group hover states (images dim via brightness-95)
- chat-header.tsx — icon buttons (back, invite, verify, settings) get real active states (bg-wash + scale-[0.96], matching the send button) with transition covering transform; truncated room name reveals via native title tooltip; member-count/meta line tightened (mt-0.5) and truncates so count + offline status never wrap into the icon cluster

Stage Summary:
- Styling-only pass across the 5 files: token-bound colors (no red/blue/neon, terracotta stays impermanence-only), no card shadows added, zero copy/feature/API changes; props and component APIs untouched
- Unified interaction language: lifted cards settle back, flat buttons press in, 0.96 icon press = send button; keyboard focus now visible on filled (forest) CTAs via ring+offset while transparent controls keep the global outline
- 44px touch targets preserved everywhere (incl. expanded hit areas on the attachment-slip chips); all transitions 150ms, no new animations — prefers-reduced-motion overrides in globals.css continue to hold
- bun run lint clean; tsc shows only pre-existing errors in store/app.ts + lib/crypto.ts (outside this pass's scope, untouched)

---
Task ID: 7-a, 7-b, 8
Agent: lead (Z.ai Code) + frontend-styling-expert (7-a)
Task: Polish pass, re-verification, deliverables

Work Log:
- 7-a (subagent, glm-5.3): polished landing (rhythm, focus rings, short-screen media query), room cards (paper-lift hover, locked muting, unread dot alignment, ash strikethrough), composer (transition consistency, disabled dimming, chip radius, attachment slip), bubbles (tabular-nums countdown, meta alignment, system rhythm, file card hovers), header (active states, truncation). lint clean after.
- Fixed remaining tsc errors: fromB64 → Uint8Array<ArrayBuffer>; wireRelay setter accepts updater functions. src/ now type-clean.
- 7-b: browser re-verification — fresh landing, room creation, messaging, dark mode all working post-polish; 0 console errors.
- 8: DESIGN.md written at project root (token sheet both themes, component inventory, motion spec table, rationale lines, architecture record).

Stage Summary:
- CipherChat complete and verified: all S1–S9 with real browser E2EE, two-member flows browser-tested, design review scores 9/9/8/8 with flagged issues fixed.
- Dev server: Next.js :3000 (via gateway :81 externally), relay :3003 — both running.
- Next phase owners (cron webDevReview): keep iterating on styling detail and features per the standing brief in this worklog + DESIGN.md.

---
Task ID: 9, 10, 11, 12
Agent: lead (Z.ai Code) — webDevReview round 1 (cron)
Task: QA sweep + feature round (typing indicators, drag-drop/paste attach, time-gap dividers, char limit, sheet grabbers)

Work Log (current status / done / verified):
- Status assessment: S1–S9 stable from prior rounds; both services up; fresh smoke test (landing → create room → message) + dark-mode sheet screenshots passed VLM defect scan ("fine" × 3); 0 console errors on clean load.
- QA bug found & fixed: TWO stale `bun --hot` relay processes existed; the port owner had hot-reloaded without registering new handlers. Cleanly killed both, restarted — bun --hot does NOT reliably apply new socket.io connection handlers; ALWAYS manually restart the relay after editing mini-services/relay-service/index.ts (kill the old PIDs first, check `ss -tlnp | grep 3003`).
- New features, all browser-verified with two live sessions:
  1. Typing indicators: relay `member:typing` broadcast (blind, transient); store typing map with 3.5s TTL + prune timers, 2.5s emit throttle, cleared on message arrival; quiet ink-alias whisper line in a reserved 26px strip above the composer ("Velvet Owl is writing…" / "A and B are writing…" / "Several people are writing…"), aria-live=polite, no layout jump.
  2. Composer attachments now arrive three ways: paperclip, drag-and-drop (dashed forest "Release to attach" overlay on the composer while hovering, verified appears + clears), clipboard paste into the textarea (verified, replaces slip). pickFile now chunked base64 (8KB) for large files.
  3. Time-gap dividers: quiet centered t-meta timestamp between messages >30 min apart ("17:04" / "Wed · 17:04" across days), role=separator. Tested with temporary 5s threshold, reverted to 30 min.
  4. Message length guard: maxLength 4000 + near-limit counter ("100 characters left", terracotta at zero with calm copy), aria-describedby, appears/disappears verified.
  5. Sheet grabbers: 36×4 centered mute handle on all mobile bottom sheets (create, unlock, invite, verify, settings) — not on desktop right-side sheets.
- lint clean, tsc src-errors 0, dev.log clean (200/201s only), relay :3003 single healthy process.

Unresolved issues / risks:
- None open from this round. Known accepted behaviors: offline members miss relayed messages (by design, ephemerality); typing whisper requires both parties online (fine); relay restart drops presence briefly until socket.io auto-reconnect (a few seconds).

Priority recommendations for next phase:
- Styled scroll-to-bottom affordance when scrolled up in a long room (quiet, appears only when needed).
- PWA installability: minimal no-cache service worker (manifest + icons already exist).
- Optional: keyboard shortcut hints (Escape closes sheets — already native via Radix); "delivered" state on self messages beyond relay ack if a peer-ack protocol is desired (design decision needed: brief says quiet).
- Remember: manual relay restart required after any edit to mini-services/relay-service/index.ts.
