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

---
Task ID: 13, 14, 15
Agent: lead (Z.ai Code) — webDevReview round 2 (cron)

Task: Status assessment + QA sweep + feature round (scroll-to-bottom affordance, message copy menu, PWA service worker, invite sheet layout fix)

Current project status / assessment:
- Both services healthy on start: Next.js :3000 (single), relay :3003 (single bun --hot process). dev.log clean (200/201s only).
- Golden-path E2E re-verified with two live sessions through gateway :81: landing → create room → invite link → second session joins (S8 empty state correct) → bidirectional E2E messaging with signature verification → typing whisper works with real keystrokes (NOTE: synthetic `input` events via eval do NOT trigger React onChange — always test typing with agent-browser `type` command).
- VLM design review round on the current state found: invite sheet password wraps to 2 lines on 390px with misaligned action buttons (real, fixed this round); mobile sheet cutoff claim (false positive — full-page screenshot artifact; measured dialog 435px, note bottom 812 < 844); header density (acceptable, 44px targets already).

Work Log (done / verified):
1. Invite sheet restructure (invite-sheet.tsx): actions moved to the label row (Copy on link; Show/Hide + Copy on password) with -my-2 compensation; value boxes full-width break-all mono — long passwords now fit one line on 390px (verified: pwLines=1), boxes pixel-aligned (labels/boxes x=861, widths 399/399), link fully visible (trust). Revealed password gets select-all for manual copy.
2. Scroll-to-bottom affordance (chat.tsx): messages area wrapped in relative container; quiet pill (bg-side, hairline, shadow-float, h-11, rounded-full, bottom-3 centered to the MESSAGE AREA not viewport) appears when >220px from bottom AND content overflows; shows "Latest" w/ ChevronDown (forest) or "N new messages" w/ forest dot when peers' messages arrive below the fold (system/self messages excluded from count — they auto-scroll); click → smooth scroll (prefers-reduced-motion → auto), resets count; settle entrance. Centering verified via bounding boxes (Tailwind v4 translate property composes with settle keyframe transform — no conflict).
3. Message copy context menu (bubble.tsx): CopyMenu wraps every bubble (text + file cards); right-click on desktop, press-and-hold on mobile (Radix ContextMenu); single quiet item "Copy text" / "Copy file name" + toast; styled as paper: rounded-[12px], border-hairline, bg-paper (nightfall adapts), single soft shadow via arbitrary value shadow-[0_1px_2px_rgba(28,24,20,0.08)] — IMPORTANT: custom class shadow-float LOSES to the base component's shadow-md because tailwind utilities layer beats components layer; use arbitrary values to win tailwind-merge conflicts.
4. PWA service worker (public/sw.js + src/components/cc/sw-register.tsx registered in layout): network-first navigations (cache only when offline), stale-while-revalidate for /_next/static, /icons, /fonts; NEVER caches /api/ or socket.io — ephemerality preserved; versioned caches (cipherchat-v1-*) cleaned on activate; registers after 1.2s delay, failures silent. Verified: registration active, both caches created, sw.js served 200.
- Verified in both themes: pill, menu (radius 12px + exact spec shadow + nightfall bg confirmed via computed styles), invite sheet.
- lint clean; tsc src/ errors 0 (remaining tsc errors are pre-existing in examples/ and skills/ only); no console/page errors; dev.log clean.

VLM false positives this round (do not "fix"): jump pill/menu overlapping message content behind them (overlay-by-design); a stale light-mode screenshot misread as dark-mode failure; suggestion to tighten bubble line-height contradicts the brief (Lora 15.5/1.5 is the signature choice — messages are letters).

Unresolved issues / risks:
- None open. Known accepted: offline members miss relayed messages (by design); typing whisper needs both online; relay restart drops presence briefly.
- The relay was NOT edited this round — no manual restart needed. If mini-services/relay-service/index.ts is ever edited: kill old PIDs first, verify single listener on :3003 (bun --hot does not reliably reload socket handlers).

Priority recommendations for next phase:
- Room list: quiet keyboard shortcut (g then r or simply Escape from chat → rooms) — low value, optional.
- Consider a "quiet hours" hint: when a room's default TTL is 5m, show a one-time hint chip near the composer explaining messages vanish (educates without nagging).
- File viewer: add keyboard Escape close + focus trap audit if not present.
- Optional deep polish: skeleton shimmer for the room list first paint on very slow devices (currently instant from localStorage).
- Remember: test typing indicators with real keystrokes; use arbitrary shadow values to beat shadcn base shadow-md.

---
Task ID: 16, 17
Agent: lead (Z.ai Code) — webDevReview round 3 (user-reported bug)

Task: Fix "on mobile, the keyboard covers the modal/bottom popup" + explain the apparent loop

Current project status / assessment:
- Both services healthy (Next :3000 single, relay :3003 single bun --hot). lint clean, tsc src/ clean, dev.log clean.
- Root cause of the bug: all mobile sheets are Radix dialogs with `position: fixed; bottom: 0`, and the chat shell is `h-dvh`. iOS Safari OVERLAYS the page with the keyboard (layout viewport never resizes) → keyboard rises over the sheet inputs and the composer. Android Chrome (default `interactive-widget=resizes-visual`) keeps fixed elements anchored to the un-resized ICB too.
- The "stuck in a loop" question: the mandated 15-min `webDevReview` cron job fires a fresh review round every 15 minutes; each round's agent-browser QA produces the wall of identical `GET / 200` lines in dev.log. It is scheduled work, not a deadlock. Cron job "CipherChat webDevReview (every 15 min)" verified present with the exact mandated description (job_id 390512).

Work Log (done / verified):
1. `src/hooks/use-keyboard-inset.ts` (NEW): global hook mounted once in CipherChatApp. Tracks focus in/out on input/textarea/select/contenteditable; while editing, measures the keyboard's covered height via the standard visual-viewport formula (documentElement.clientHeight − vv.height − vv.offsetTop, clamped 0..60% layout height) on vv resize/scroll + window resize, and publishes it as `--kb-inset` (px) on <html>. No editable focused → stays 0px, so desktop/headless/URL-bar collapse never false-positives (browser-verified: focus in headless leaves var at 0px). rAF-batched; focusout re-checks activeElement after a tick so focus hops between fields don't flap.
2. `layout.tsx`: viewport meta now includes `interactive-widget=resizes-content` — Android Chrome resizes the layout viewport for the keyboard, so dvh shells + fixed sheets rise natively (kb-inset reads ~0 there; the two mechanisms never double-count). Verified served in HTML meta tag.
3. `ui/sheet.tsx` bottom variant: `bottom-0` → `bottom-[var(--kb-inset,0px)]` + `max-h-[calc(100dvh-var(--kb-inset,0px))]` + `transition-[bottom,max-height] duration-[250ms]`. `bottom` is a position property → composes cleanly with the slide keyframes (no transform conflict). Tall sheets now cap at the visible viewport and scroll inside.
4. `cc/app.tsx`: shell gets `pb-[var(--kb-inset,0px)] transition-[padding-bottom] duration-[250ms]` — the composer, typing strip and message column rise above the keyboard; the message scroller shrinks to the visible area (scrollTop clamps naturally: stays pinned to bottom if it was at bottom).
5. Sheets hardened for the new max-h cap: invite, create (landing), unlock (room-list) SheetContents now `overflow-y-auto overscroll-contain scroll-quiet` (settings + verification already had internal scroll).
6. globals.css: (a) `--kb-inset: 0px` default in :root; (b) iOS input-zoom guard — `@supports (-webkit-touch-callout: none) and (pointer: coarse) { input, textarea, select { font-size: 16px } }`, unlayered so it outranks Tailwind utilities. This kills Safari's focus-zoom on 15/15.5px fields which magnified the keyboard-cover problem. Desktop Safari unaffected (pointer: fine).
7. QA (agent-browser 390×844, keyboard simulated by publishing exactly what the hook publishes on-device: `--kb-inset: 301px`):
   - Create sheet: bottom 844 → 543 (= 844−301), password field bottom 408 (fully visible), max-h 543.
   - Chat: shell padding-bottom 301px, composer bottom 832 → 531, message column shrank 844→448 bottom edge; typed + SENT a real message post-fix (bubble rendered, "Typing above the keyboard" + time).
   - Settings sheet (tallest, has input): bottom 543, top 0, max-h 543, overflow-y auto — Burn button below the fold inside the scrollable sheet (by design: destructive action not adjacent to keyboard).
   - Blur → hook resets var to 0px → sheet/composer settle back (844/832) — verified on all three surfaces.
   - Desktop 1280×800: shell padding 0, layout unchanged.
   - VLM review of 4 screenshots: no overlap/clipping/broken layout; composer + typed text fully visible above keyboard zone.
   - 0 page errors, 0 console errors; lint clean; tsc src/ errors 0; dev.log clean.

Unresolved issues / risks:
- The visualViewport inset formula is the standard approximation; if a future device reports visualViewport oddly (foldables, split-screen), `--kb-inset` could mis-measure — it is clamped (0..60% of layout height) and only active while an editable is focused, so worst case is a conservative offset.
- Pinch-zoomed typing (vv.scale ≠ 1) is not compensated (accepted; same as most keyboard-aware libs).
- Real-device iOS/Android validation still recommended when a physical device is available (headless cannot summon a true virtual keyboard; the published-var simulation was verified instead, which exercises the identical CSS path).

Priority recommendations for next phase:
- Consider scroll-into-view of the focused field inside tall sheets on iOS (Safari usually handles it; only worth adding if field-testing shows gaps).
- Continue standing brief: styling detail + features. Ideas parked from round 2: room-list keyboard shortcut, file-viewer Escape/focus-trap audit.
- Remember: manual relay restart required after any edit to mini-services/relay-service/index.ts; test typing with real keystrokes; arbitrary shadow values beat shadcn base shadow-md.
