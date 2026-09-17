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

---
Task ID: 18
Agent: lead (Z.ai Code) — user request (documentation)

Task: Write a detailed markdown reference of all available components, how they work, and what they do

Work Log:
- Read every component in full for accuracy: cc/ (actions, mark, sealing, burn-overlay, bubble, chat-header, composer, fields, file-viewer, invite-sheet, verification-sheet, settings-sheet, sheet-grabber, theme-toggle, sw-register, app), screens/ (landing, invite, room-list, chat), hooks (use-is-desktop, use-keyboard-inset), page.tsx/layout.tsx
- Skimmed the data layer for exact API surfaces: store/app.ts (state shape + all actions), lib/ exports (crypto, identity, session, local, relay, format, types), globals.css (typography classes, keyframes, materials)
- Determined actual shadcn/ui usage by import grep: only Sheet, Dialog, ContextMenu, Sonner are used; documented the rest as available-but-unused stock
- Wrote /home/z/my-project/COMPONENTS.md (project root, beside DESIGN.md): 12 sections — architecture map, app shell, all four screens (S1/S2/S4/S5-S8 with state tables), chat surface (ChatHeader, Composer with full element/behavior table, bubble grouping + CopyMenu arm logic, FileViewer), all five sheets, both ceremony overlays (S3 vault press, S6 phase chain), the verb/action system, hooks (incl. the keyboard-inset math), styling system (tokens, typography classes, materials, motion, iOS zoom guard), shadcn inventory, data layer (store + lib + REST/relay surface), and a 10-point conventions checklist for adding new components
- Verified after: lint clean, page loads 200 with 0 errors, dev.log clean

Stage Summary:
- COMPONENTS.md is now the third pillar of project documentation (DESIGN.md = tokens/rationale, worklog.md = history, COMPONENTS.md = the component/behavior reference)
- Every component entry includes: file, spec screen, props/API, states, and internal mechanics
- No code changed this round — documentation only

---
Task ID: 19-10
Agent: general-purpose (adversarial security review)
Task: Red-team review of CipherChat protocol v2 (Task 19)

Work Log:
- Read in full: src/lib/protocol.ts, src/lib/room-protocol.ts, src/lib/kdf.ts, src/store/app.ts (all brief-listed handlers: sendMessage, receiveFrame, handleOpenResult, member:left, stale-rejoin bootstrap in joinRoom, key:request in wireRelay, plus the full relay wiring and legacy receive path)
- Supporting reads to trace attacks end-to-end: src/lib/crypto.ts, src/lib/legacy.ts, src/lib/relay.ts, mini-services/relay-service/index.ts, api routes (rooms, members, leave, verifier)
- Ran `bunx vitest run` once: 6 files, 44/44 passed — no repo modifications (read-only review)
- Probed: replay-guard FIFO-eviction abuse (counter-map independence), drainPending double-park/nested-drain, pending-admission via cleartext frame.ts, open()/openOffer() check ordering for forged high-kv offers, rot=true vs rot=false coordinator gating, kv saturation arithmetic (Math.max+1 at 2^53/Infinity), unsigned-canonical-field tampering dead-ends, every relay.emit site for padding uniformity, message:ack emission path, legacy v1-envelope dispatch in v2 rooms, key:request from-field plumbing, registry write paths (member:joined/room:state/refreshMembers) and the trust boundary under them
- Severity-ranked findings; verified clean surfaces explicitly (A1 FIFO abuse blocked by counter map; A2/A3 no render-without-guard or double-processing; B3 non-member offers fully blocked; C all content emits uniform, typing via message:send everywhere; D ack display-only, v2 burn double-checked)

Stage Summary:
- P0 — Registry poisoning via unauthenticated relay room:join: member:joined handler (app.ts:941-949) writes relay-supplied pubkey/ecdhPub into cipher.registry (the signature root of trust + eviction gate); relay never authenticates memberId ownership. Any member (or password-holder) can impersonate any offline member (fake join as them → poisoned pubkey → forged signed frames render as them; victim silenced on reconnect) and deliverKeyTo hands a password-holder the current key with no server-side rejoin record. Fix: registry writes only from the server member list, or authenticated relay joins.
- P1 — Departure is self-declared: rotation fires only on the leaver's own member:leave announce; silent disconnect keeps the key forever (no rotation, server stays active). Plus unauthenticated POST /leave (memberId only) and peer-emittable member:leave (relay handler unauthenticated, not rate-limited) → repeatable forced-eviction/rotation lockout DoS. Fix: rotate on presence-loss; authenticate leave paths.
- P2 — message:spent legacy relay event patches spent:true with zero verification (app.ts:1029-1031); frame.id is cleartext → any roomId-holder can spoil view-once files. Fix: delete legacy handler.
- P2 — v1-shaped envelopes accepted in v2 rooms (dispatch on v!==2): no replay defense (unlimited duplicate rendering), no fixed-size padding (length leakage), sender gate is the UI list not the cipher registry — downgrade available to any member; departed-member injection when combined with the fake-join. Fix: gate legacy path on v1 verifier rooms; dedup legacy ids.
- P2 — key:request never carries `from` (app.ts:468,1149) → relay forwards undefined → handler's registry.has(from) always false → self-healing key delivery is dead code; every stale rejoin forces the fallback rotation instead. Fix: include from: session.memberId.
- P2 — rot=false offers skip the coordinator check (room-protocol.ts:584): any member can push a chosen key / force kv jumps; kv=2^53 or Infinity permanently bricks rotation (Math.max+1 saturates, all future offers rejected — member:left ceremony dead); same-version racing gives persistent split-brain decrypt failures. Fix: authorize all offers (coordinator or current-key proof), bound/integer-check kv.
- P2 — Replay guard is per-page-load: after refresh the counter/dedup maps are empty while keys are re-delivered → captured frames (≤10 min old) re-render for refreshed clients and pre-join traffic can be shown to new joiners. Adjacent: pending admission trusts cleartext frame.ts (future ts passes) and parked entries never expire (bounded by PENDING_MAX=64). Fix: persist counter watermark; age-expire pending.
- nit — unbounded files map (meta without chunks) and replay-guard highest map (per-sessionTag); verifier PUT set-once race window (join-DoS only).
- Clean (checked, no finding): FIFO id-eviction replay blocked by the independent never-evicted counter map; all v2 renders pass replay.check incl. drainPending; double-parked frames deduped at replay; non-member forged offers blocked by registry→entry-seal→signature→UKS→ECDH chain; every content emit in store/app.ts is uniform padded message:send (typing included everywhere); message:ack is relay-emitted display-only; v2 burn double-checked; unsigned body fields unexploitable (counter-in-canonical + replay guard); kdf v2 bundles clean.

---
Task ID: 19 (19-0 … 19-11)
Agent: lead (Z.ai Code) + general-purpose subagent (19-10 adversarial review)
Task: Security hardening pass per external acceptance review — replay protection, REAL key rotation on leave, argon2id KDF, per-room identity, uniform padding, relay/API hardening, honest documentation. RULE honored: failing tests written FIRST (all six property files were red before any implementation existed), and every fix since has shipped with its test.

Current project status / assessment:
- Protocol v2 shipped end-to-end. The review's two P0s and three silent downgrades are closed, tested (47/47), and browser-verified. Frontend untouched apart from the Settings copy (now true) and one system line.

Work Log:
- 19-0 Setup: vitest 5 + hash-wasm + @noble/curves installed; vitest.config.ts (node env, @ alias); "test"/"test:watch" scripts.
- Tests FIRST (all red, then green per module): src/lib/__tests__/{task-19.1-replay, task-19.2-rotation, task-19.3-kdf, task-19.4-identity, task-19.5-padding, task-19.6-hardening}.test.ts + helpers.ts — 47 tests named after the properties they protect.
- 19.1 Replay (P0): src/lib/protocol.ts — createReplayGuard (per-(senderId,sessionTag) monotonic counters, ±10min ts window, frame-id dedup with FIFO cap), createSendClock (per-page-load session tag). Receive pipeline order: shape → registry eviction → key version → signature → replay → dispatch. ACCEPTANCE test: captured frame re-injected after TTL burn is rejected; live re-injection does not double-render; typing frames replay-protected; unknown-sender frames rejected; tampered ct rejected.
- 19.5 Padding (P1): every frame = JSON → ECDSA sign (canonical v2) → padToSize (4-byte LE length + random fill) → AES-256-GCM. Control frames uniform 20480+16B (20480 chosen over the spec's 4096 because the product's own 4000-char worst-case UTF-8 message cannot fit in 4096 — uniformity is the property; rationale documented). Files: dataB64 padded to a FIXED 2,800,000 chars, split into exactly 44 uniform 65536+16B chunk frames + 1 control meta frame — same count and sizes for a 1KB and a 300KB file (test-asserted). Assembly sha-verified; corrupted chunk ⇒ file never renders.
- 19.3 KDF (P1): src/lib/kdf.ts — argon2id (m=65536/t=3/p=1, hash-wasm) with random 16B salt in a VERSIONED bundle {v:2,alg:"argon2id",...}; unlockWithBundle handles both v2 and legacy {iv,ct} PBKDF2 rooms (test: pre-upgrade blob still unlocks). Verified live: GET /api/rooms/:id returns the v2 bundle.
- 19.4 Identity (P1): src/lib/room-identity.ts — one device seed (cc.seed, 32B); per-room ECDSA keypair = HKDF(seed, roomId) → scalar → @noble/curves p256.getPublicKey → JWK → WebCrypto. Same seed two rooms ⇒ different pubkeys/aliases (test); same room re-derived ⇒ stable (test). The old global cc.device key is retired. Member registry (Prisma) gained ecdhPub.
- 19.2 Rotation (P0): src/lib/room-protocol.ts RoomCipher — keyring Map<kv,key> with 30s decrypt-only grace; expectedCoordinator = min memberId among connected registry; rotateTo/rotateAsCoordinator generate a RANDOM 256-bit key (never password-derived), version+1, delivered as ECDH-wrapped signed offers sealed under the ENTRY key (kv 0 wire marker) so every member can read the frame but only the recipient can unwrap the key. Acceptance tests: departed member holding password+roomId+live pipeline+kv-visibility CANNOT decrypt post-rotation frames (pending then reject); cannot inject (registry eviction); non-coordinator rot-true offers rejected; stale-kv offers rejected; UKS-mismatched ECDH rejected; grace window honored then closed. Join delivery: deliverKeyTo double-wraps (entry-key outer + ECDH inner) — test: stranger with wrong password cannot open what a rightful joiner can. DURABILITY: the server epoch (bumped on leave, persisted) is the rotation ledger — after a full-room refresh the coordinator re-seals PAST it (test: Mallory holding kv1+kv2 still cannot read kv3 traffic); key:request + version-randomized fallback rotations converge monotonically (test: dueling fallbacks converge, no split brain). Stale-rejoin bootstrap in joinRoom: 3s grace for live delivery, then coordinator rotation or randomized fallback (5–8s).
- 19.6 Hardening (P2): src/lib/rate-limit.ts — TokenBucket (20 frames/s, burst 64) per relay socket; IpRateLimiter (5 rooms/min) on POST /api/rooms (429); frame-size cap 128KB → hard disconnect; 16-room cap per socket. All unit-tested; relay restarted manually (operational rule).
- 19-7 Store wiring: store/app.ts rewritten onto the cipher — encrypted typing (uniform frames, relay can no longer see WHEN someone types), chunked file send/receive, burns/spends as encrypted frames, member:left → REST-confirmed eviction + coordinator rotation + system lines ("X left." / "The room re-sealed for those who remain."), pending-buffer key:request self-heal, resealing chip = awaiting key delivery. v1 envelopes accepted ONLY in legacy rooms (session.legacy from bundle version) + id-dedup.
- 19-10 Adversarial review (general-purpose subagent, read-only) found: [P0] relay room:join carries no auth → registry poisoning + stealth key theft via forged member:joined; [P1] unauthenticated member:left/leave; [P2] legacy message:spent spoiler; [P2] v1 downgrade in v2 rooms; [P2] key:request never carried `from` (dead path); [P2] rot=false chosen-key push + kv=2^53 rotation brick; [P2] per-page-load replay state; [nit] unbounded maps. ALL FIXED: registry writes are REST-authoritative only (room:state presence-only; member:joined refreshes REST before trusting/delivering; forged joins get no keys); member:left REST-confirmed before evict/rotate; legacy message:spent handler deleted; legacy path gated; key:request carries from; KVERSION_CAP 1e6 + safe-integer checks (test: absurd kv rejected, room still rotatable); watermarks persisted per room per device (test: replayed counter refused across refresh); pending entries age-expire (test); files map capped. Residual risks documented in the threat model instead of hidden.
- 19-9 Browser E2E (agent-browser): create (argon2id bundle v2 on server) → join with genuinely distinct identity → bidirectional signature-verified messaging → encrypted typing whisper → LEAVE → both rotation lines → post-rotation messaging → REJOIN via link → key delivered on join → messaging under the delivered key → 21KB file through 45 uniform frames with sha-verified assembly → view-once sealed → open → spent-for-everyone → refresh-lock + argon2id unlock → stale-rejoin bootstrap line → fallback self-heal → keyboard-inset regression (composer at 531 with --kb-inset:301) → 0 page errors on both origins. QA gotchas solved: two tabs share localStorage (identities collided) — fixed by using TWO ORIGINS (localhost:81 vs 127.0.0.1:81); PWA service worker served stale /_next/static chunks mid-edit — unregister + clear caches during QA.
- 19-8 Docs: README.md created (product intro + "What CipherChat does NOT protect against" — metadata, view-once passivity, silent leavers, insider sabotage, immutable password, endpoint compromise, replay residual, nation-states → Signal/SimpleX); DESIGN.md §5 rewritten for protocol v2 + new §6 threat model; COMPONENTS.md data layer/backend/sealing sections updated.
- Final: 47/47 tests, tsc src clean, lint clean, dev.log clean (200s only), all three services up.

Stage Summary:
- The review's scoreboard gaps are closed: crypto/protocol vs spec — replay (counters/window/dedup/watermarks), rotation (random keys, ECDH pairwise, ledger-durable, convergent fallback), argon2id (64MB, versioned, legacy-compatible), per-room identity (HKDF from device seed), padding (uniform control frames + fixed-count file frames, typing encrypted). Honesty: Settings copy now states exactly what happens; README + DESIGN threat model state exactly what does NOT.
- The security logic is centralized in RoomCipher (room-protocol.ts) with 47 property tests named after the task items; the store is a thin adapter.
- Remaining accepted risks are documented, not silent: silent leavers retain keys until next rotation; insiders can nuisance-rotate; replay-to-fresh-device within 10min; metadata visibility.

Priority recommendations for next phase:
- The standing feature-brief cron was suspended for Task 19 per the reviewer's instruction; it is re-armed now that the task is closed (next rounds may resume styling/feature work on top of protocol v2).
- If another hardening round is wanted: authenticate relay joins with a server-issued member token (removes the REST round-trip on every join), presence-driven rotation grace, and a TLS-like handshake transcript binding for offers.
- Operational reminders: manual relay restart after mini-services edits; two-member browser QA needs two ORIGINS (localhost vs 127.0.0.1) — tabs share localStorage; unregister the service worker before hot-reload QA.

---
Task ID: 20 (20-0 … 20-c)
Agent: lead (Z.ai Code) + frontend-styling-expert subagent (20-c, styling pass)
Task: webDevReview round 20 — QA + bug fix + features + styling per standing brief (fix bugs first, then mandatory styling details + mandatory features)

Current project status / assessment (at round start):
- Protocol v2 (Task 19) closed: 47/47 tests, both services healthy (Next :3000, relay :3003), dev.log clean. This round returned to the standing styling/feature brief.

Work Log:
- 20-0 QA (agent-browser, two origins localhost:81 + 127.0.0.1:81): create (argon2id) → join → bidirectional signature-verified messaging → file transfer → unlock/rejoin bootstrap → all healthy. ONE REAL BUG FOUND: text typed alongside a file attachment was SILENTLY DROPPED — the wire FileMetaBody carried no caption and the bubble rendered FileContent exclusively (both sender's optimistic view and receivers). Also identified my own QA artifacts (a NotFoundError from a missing test file) and a stale-console probe from the previous round (not in code).
- 20-1 FIX file captions (6 tests: task-20.1-caption.test.ts): FileMetaBody now rides the meta frame's TOP-LEVEL text field — canonicalV2 signs it, so a caption is exactly as unforgeable as a text message. sealFile(opts.text), AssemblingFile.text, OpenResult "file" carries text, store passes trimmed caption + renders it, bubble renders caption as t-body above the file card, CopyMenu gains "Copy caption". Meta frames stay uniform size regardless of caption length (test-asserted; 4000-char worst-case UTF-8 fits CONTROL_FRAME_BYTES). E2E verified on both origins.
- 20-2 FEATURE ink reactions (5 tests: task-20.2-reactions.test.ts): four product-vocabulary marks (✓ Acknowledged · ✦ Noted · ♥ Warmly received · ☾ Later — REACTION_MARKS in lib/types.ts). New FrameKind "react"; sealReact(messageId, mark) puts the glyph in the canonical-signed text field and the target in messageId; open validates isReactionMark (arbitrary strings rejected as shape). One mark per sender per message; the toggle transition (set/clear/move) is applied identically by the optimistic local update and every receiver (applyMarkToggle in store) so frames converge. UI: "Mark this message" context-menu submenu (desktop right-click, touch long-press) + MarksBar chips under the bubble (serif glyph + count, who-marked tooltip, own mark highlighted, click toggles). Marks resolve memberIds → live aliases at render ("Someone who left" fallback). E2E verified: mark set on member B → chip on both tabs; creator chip-click adds (✓2) → chip-click removes (✓1) → both tabs converge.
- 20-3 FEATURE Escape-to-rooms: in ActiveRoom, Escape with an empty composer navigates to the room list; sheets/menus/dialogs/file-viewer own the key first (defaultPrevented + [data-state=open]/[role=dialog] guards). Verified live in the browser (it fired during QA screenshots — the guard logic works).
- 20-c STYLING pass (frontend-styling-expert subagent; verified and kept after its context deadline — tsc/lint/tests green): landing entrance choreography (staggered settle: seal → headline → CTAs → footer); room-list rows settle onto the desk (30ms stagger, capped); unread dot gets dot-pulse; ChatHeader presence — per-member ink dots in their own color (away = 35% opacity, dot-in entrance) before the member count; TypingLine gains three aria-hidden typing-dot ink dots before the aria-live sentence; jump pill hover-lift; file-card icon tint + download glyph shift on hover; SecondaryAction hover border; DestructiveAction token cleanup (text-paper); paperclip rotates 10° on hover; TTL button press physics. globals.css: mark-in (chip entrance), mark-count (count beat), typing-dot, dot-in keyframes. VLM review of 6 screenshots (light+dark landing, chat with marks, room list): landing CLEAN both themes; 2 flagged items on the chat shot were geometrically disproven via DOM measurement (chip sits 4px below the bubble, right edges intentionally aligned, caption padding matches the text-bubble system).
- 20-4 FIX recurring QA gotcha at the source: sw-register.tsx no longer registers the service worker in development (NODE_ENV guard) — the stale-chunk-through-SW problem bit this round three times (a phantom "@lib/format" module-not-found from a briefly-typo'd import kept replaying from cache). Verified: after unregister + reload, swCount stays 0.
- 20-5 Docs: README (ink marks + captioned files in "What it is"; uniformity row lists ink marks + file meta; test counts updated to 58), COMPONENTS.md (CopyMenu mark submenu, MarksBar, caption rendering, chat keyboard layer, TypingLine dots, ChatHeader presence dots).

Stage Summary:
- 58/58 vitest green (47 protocol + 6 caption + 5 reactions), tsc src clean, lint clean, dev.log clean, both services single-listening.
- Bug fixed: file captions were silently dropped (now signed + rendered + copyable).
- Features added: ink reactions (full protocol→UI), Escape-to-rooms shortcut.
- Styling: entrance choreography, presence ink dots, typing dots, hover micro-interactions across all surfaces, dark mode verified.
- Operational: service worker dev-guard closes the stale-chunk class of QA failures permanently.

Unresolved issues / risks:
- Reactions to a message that arrives on a receiver AFTER the react frame (out-of-order delivery for a receiver that missed the target message entirely, e.g. pre-join) are quietly ignored by design — the mark has nothing to annotate.
- Marks on view-once files remain after the card is spent (intentional — the margin note outlives the sealed letter).
- VLM screenshot review remains advisory; this round's two flags were false positives, verified by DOM geometry.
- Relay hardening rules unchanged: if mini-services/relay-service/index.ts is ever edited, manual restart required (not edited this round).

Priority recommendations for next phase:
- Presence-driven rotation grace (rotate when a member's connection drops for >N min, not only on clean leave) — closes the documented "silent leaver retains keys" gap.
- Relay join member token (server-issued auth on room:join, removing the REST confirmation round-trip).
- Optional polish: room-list skeleton shimmer (cosmetic, low value — list is instant from localStorage), draft persistence per room across room switches within a session.
- Operational reminders: two-member QA needs two ORIGINS; relay restart after mini-service edits; QA gotcha now closed (SW no longer registers in dev).

---
Task ID: 21-3
Agent: frontend-styling-expert (context deadline hit after completing edits; verified and kept by lead — tsc/lint/tests green)
Task: Round 21 mandatory styling details pass on the new round-21 surfaces

Work Log:
- globals.css — 4 new keyframes with one-line comments: strip-in / strip-out (the line-down note unrolls in and rolls away, height-collapsing), still-trying (the terracotta dot breathes — "still attempting" rather than dead), chip-pop (unread pill entrance), draft-restored (a soft forest focus-ring pulse when a saved draft swaps in). All capped by the existing prefers-reduced-motion guard (150ms/1-iteration).
- chat.tsx — the relay-offline strip became a render-time state machine (gone/down/lifting) released by onAnimationEnd (never a timer): strip-in on drop, strip-out + lift when the courier returns; padding moved to the inner row so the animated outer strip collapses all the way.
- room-list.tsx — the unread count chip: chip-pop entrance, chip-beat on count change (keyed by card.unreadCount), group-hover deepens to bg-forest-deep with a 105% scale nudge; count cap "99+"; the plain dot remains for non-letter activity with aria-label "New activity".
- composer.tsx — draftCue state (armed at mount and on render-time room swap, cleared onAnimationEnd) drives the draft-restored ring on the textarea.
- Locked-room view and UnlockSheet were reviewed and deliberately left alone (already consistent; no clear win).

Stage Summary:
- Every new round-21 surface now has entrance/exit motion in the paper/forest voice; reduced-motion respected; no a11y semantics touched.

---
Task ID: 21 (21-0 … 21-4)
Agent: lead (Z.ai Code) + frontend-styling-expert subagent (21-3)
Task: webDevReview round 21 — QA + bug fixes + features + mandatory styling, per standing brief. Top priority from round 20's recommendations: presence-driven rotation grace (the documented "silent leaver retains keys" gap).

Current project status / assessment (at round start):
- Protocol v2 stable (58/58 tests), both services healthy, dev.log clean. This round: the silent-leaver gap CLOSED, four UX features, a styling pass, and one critical wiring bug caught by E2E before it could ship.

Work Log:
- 21-0 QA: 58/58 tests, lint clean, both services listening, browser smoke (create → invite sheet → message send). UX nit found: the composer lost focus after the invite sheet closed (became feature 21-2b).
- 21-1 FEATURE silent-departure grace (16 tests: task-21.1-silent-grace.test.ts, written RED first):
  - lib/silent-grace.ts (pure): SILENT_GRACE_MS=120s (client clock), EVICT_MIN_OFFLINE_MS=60s (server floor), authorizeEviction (9 refusal reasons incl. fail-closed "presence-unavailable"), stillSilentAtExpiry (the client's gate).
  - Relay (mini-services/relay-service/index.ts, manually restarted per rule): wentOfflineAt stamp on every silent last-socket drop (cleared on join/clean-leave/room-burn); member:expired forward (rate-limited, broadcasts like member:left); INTERNAL PRESENCE SNAPSHOT on port 3004 — GET /presence/:roomId guarded by the shared RELAY_INTERNAL_TOKEN header (added to .env; relay now runs `bun --hot --env-file=../../.env index.ts` via its dev script; /tmp/relay-supervisor.sh updated to `bun run dev`). Curl matrix verified: no token 403, wrong token 403, wrong path 404, right token 200 with live data.
  - REST POST /api/rooms/:id/evict: gathers facts (DB registry + relay snapshot via 3s-timeout server-to-server fetch), obeys authorizeEviction, deactivates the target + bumps the epoch (rotation ledger), 30/min/IP. Server-side matrix verified with curl: self→409 "self", fake caller→409 "caller-unknown", real eviction→200 + epoch bump, re-evict→409 "target-unknown" (idempotent). Unknown rooms answer ok:true (existence not confirmed to strangers).
  - Store: silentGrace timer map armed by member:presence(false) AND the room:state honest-diff (registry members absent from the relay's live list are marked offline — also fixes the pre-existing stale away-dot after refresh); fireSilentEviction (only the still-connected coordinator acts) → POST /evict → member:expired announce → confirmDeparture() locally. member:left and member:expired now share confirmDeparture() (REST-confirmed eviction, "X left." vs "X drifted away.", coordinator rotation, "The room re-sealed for those who remain."). Grace clocks cancel on any return; clear on leave/burn/relay-disconnect.
  - E2E (two origins): B closes the tab silently → 120s grace → A's room shows "Ashen Wren drifted away." + "The room re-sealed for those who remain." → DB: B inactive, epoch 2 → B returns with the password → key delivered (kv2) → bidirectional messaging under the rotated key. The pre-eviction curl tests + unit tests cover too-soon/target-online; the invariant test asserts client grace > server floor.
- 21-2 FEATURES:
  a) Per-room composer drafts (lib/drafts.ts, memory-only like the keys): the draft swaps with the room (render-time adjustment — lint's set-state-in-effect rule forced the sanctioned pattern), cleared on send/leave/burn. E2E: draft typed in Alpha → switch to Beta (fresh) → back to Alpha → draft restored + composer focused.
  b) Composer auto-focus on room entry (desktop only — touch keyboards stay closed) + after the invite sheet closes (Radix onCloseAutoFocus preventDefault → composer.focus(); the naive effect lost the focus race to Radix's trigger restoration).
  c) Relay-offline strip in the chat: "The line is down — letters pause until it returns." (role=status, terracotta) — E2E: relay fully stopped → strip + composer lock after the ping-timeout window → relay restarted → strip lifts, composer re-enables, both members auto-rejoined, post-recovery message delivered.
  d) Unread counts: RoomCard.unreadCount (persisted number — metadata only), touchCard(roomId, unread, letters) counts real letters (text/file/legacy renders; joins and rejections stay dot-only), capped 99, reset on room entry. E2E: A at the desk, B sends 2 → sidebar chip "2" (aria "2 unread messages"), dot correctly absent.
- 21-3 STYLING (frontend-styling-expert; see its section above — verified and kept after its context deadline).
- 21-4 E2E + fixes found BY the E2E (the round's real wins):
  - **CRITICAL wiring bug caught**: fireSilentEviction passed memberConnected as the RESULT of comparing (true when offline) instead of the member's connected STATE (false when offline) — inverted semantics meant stillSilentAtExpiry would NEVER pass: the grace could never fire in production. The pure function's 16 tests were correct; only live E2E caught the adapter. Fixed + commented; the fast-probe technique (temp 10s grace + 5s floor, console probes, clean reloads) found it in minutes.
  - **Latent double-registration bug**: init()'s ready-guard has an await gap — two concurrent init() calls (remount racing mount) register every relay handler twice (observed as duplicate member:presence processing). Fixed with a synchronous initStarted flag before the first await.
  - QA-process rule learned the hard way (three times): **never edit code mid-E2E** — Fast Refresh re-evaluates the store module and leaves open tabs with stale sockets/duplicate handlers/stuck relayOnline. Any edit ⇒ reload every tab before continuing. Also: background tabs drop focus (press Enter fails) — send via the Send button or eval+input event; two-member QA needs two ORIGINS (localhost:81 vs 127.0.0.1:81).
  - VLM review of 3 screenshots (light chat, desk, dark chat): CLEAN ×3.
  - Docs: README (grace row in the property table + test counts 74 + the NOT-protect list now says "closed by the grace"), DESIGN.md §6 threat model (silent leavers bounded; nuisance-evicter residual documented), COMPONENTS.md (round-21 internals, lib table, backend surface incl. :3004 snapshot).

Stage Summary:
- 74/74 vitest green (58 + 16 silent-grace), tsc src clean, lint clean, dev.log clean, relay :3003 + snapshot :3004 supervised and token-armed.
- The silent-leaver gap is closed end-to-end: relay stamps the disconnect clock, clients watch a 120s grace, the server verifies against live presence before writing anyone out, the epoch ledger makes the re-seal durable, and the departed member simply re-enters with the password.
- Features: drafts, auto-focus, relay-offline strip, unread counts. Styling: strip choreography, chip pop/beat, draft-restored ring (subagent pass verified green).
- Two real bugs the E2E caught before they could ship: the inverted memberConnected wiring (grace-dead) and the init double-registration.

Unresolved issues / risks:
- The evict route trusts the relay's in-memory clock; a relay restart mid-grace loses offlineSince and falls back to the DB's lastSeenAt (join time) — honest but coarser (documented in the route).
- A nuisance-evicter who knows only the roomId can force a rotation while a member is away (same accepted-risk class as insider nuisance-rotations; the member re-enters with the password) — documented in DESIGN.md.
- The relay strip appears only after the client's ping-timeout detection (~60-85s worst case through the gateway); sub-second relay bounces are often invisible (correct, quiet behavior).
- member:presence/member:expired remain unauthenticated at the relay (rate-limited) — safe because every consumer REST-confirms; unchanged from 19-10 posture.
- QA gotcha for future rounds (now triple-confirmed): reload ALL tabs after ANY code edit mid-QA; service worker dev-guard from round 20 held throughout (swCount 0).

Priority recommendations for next phase:
- Relay join member token (server-issued auth on room:join — removes the REST confirmation round-trip and the last unauthenticated relay ingress).
- Optional polish candidates: burn-room countdown affordance in the header, member list sheet (who's who + fingerprints in one place), room-list skeleton shimmer (still low value).
- If another hardening round: TLS-like handshake transcript binding for key offers; presence-driven rotation could gain a per-room grace override in settings.
- Operational reminders: manual relay restart after mini-service edits (supervisor + `bun run dev` now carries --env-file; double-fork `setsid` pattern required to survive the tool session); two-member QA needs two ORIGINS.

---
Task ID: 22-b
Agent: general-purpose (security residuals)
Task: Security residuals hardening — proof-of-possession for leave, per-IP rate limits on the registry endpoints, freshness-windowed member cap, explicit scalar-range handling in room identity derivation, DESIGN.md threat-model updates (test-first).

Work Log:
- Wrote the three property suites RED first (18 tests): task-22.1-leave-proof (9), task-22.2-identity-range (5), task-22.3-admission (4) — all named after the property they protect, matching the task-19 style.
- lib/leave-proof.ts (new): LEAVE_PROOF_TOLERANCE_MS = 10 min; leaveProofInput → exact canonical `cc-leave-v1:${roomId}:${memberId}:${ts}`; signLeaveProof/verifyLeaveProof reuse crypto.ts signCanonical/verifyCanonical (WebCrypto ECDSA P-256 SHA-256, standard base64). verify returns false — never throws — for non-JWK pubkeys, malformed b64, wrong signatures, non-finite ts, and |now − ts| > tolerance; boundary at exactly ±10 min still verifies (test-asserted). Replay of a valid {ts,sig} still verifies — acceptable and documented in the test: leaving is idempotent, and nuisance rotation requires the victim's own valid signature.
- room-protocol.ts: public RoomCipher.signDepartureProof(ts = Date.now()) signing (this.roomId, this.selfId) with this.sigPrivJwk, placed next to sealBurn in the signing section.
- leave route: body {memberId, ts, sig} all required → 400 "invalid-proof"; unknown room/burned/missing member keeps the old ok:true semantics (existence not confirmed to strangers); member.pubkey JSON-parsed and verified via verifyLeaveProof → 403 "bad-proof" on failure. Module-level IpRateLimiter 20/min/IP with a locally-copied clientIp helper. DEVIATION (deliberate): on verify success a member row that is ALREADY inactive no-ops without bumping the epoch — makes the specified replay comment literally true ("bumps epoch at most once per window") and closes a 10-minute replay-rotation nuisance; the first valid leave behaves exactly as before (mark inactive, bump epoch, return {ok, epoch}).
- store/app.ts leaveRoom: getCipher(roomId) BEFORE dropping anything; with a cipher it awaits signDepartureProof() and POSTs {memberId, ts, sig}; with NO cipher (locked/refreshed tab) the REST call is skipped entirely (the server would 400 it anyway) and the relay member:leave announce still fires — receivers handle a keyless departure via the silent-eviction grace path (commented in place).
- lib/rate-limit.ts: added ROOM_INFO_PER_MIN = 30, MEMBER_JOIN_PER_MIN = 12, MEMBER_FRESH_WINDOW_MS = 15 min (documented).
- [roomId]/route.ts (GET room info) and [roomId]/verifier/route.ts (PUT): each gained its own module-level IpRateLimiter (ROOM_INFO_PER_MIN) → 429 "slow-down" on excess; clientIp copied locally per file; all existing behavior otherwise preserved.
- lib/admission.ts (new): ROOM_MEMBER_CAP moved here (12); decideAdmission — existingMemberId → "rejoin" (always, even when full), recentlySeenCount >= cap → "full", else "admit"; cap override supported. rooms/route.ts re-exports ROOM_MEMBER_CAP from @/lib/admission (old import sites keep working); [roomId]/route.ts and members/route.ts updated to import from @/lib/admission directly.
- members route POST: per-IP join limiter (MEMBER_JOIN_PER_MIN) → 429; inline cap check replaced by decideAdmission over a count of active members with lastSeenAt within MEMBER_FRESH_WINDOW_MS, with an honest comment on the trade-off (freshness-windowed SOFT cap: stops a code-holder without the password from permanently locking the room with throwaway keys; coordinated many-IP attackers can still exceed it — presence noise, not a confidentiality issue, per the Task 19 acceptance review). Rejoin/upsert path untouched.
- lib/room-identity.ts: added bytesToBigIntBE + exported scalarToRoomIdentity(scalar) → RoomSigningIdentity | null with an EXPLICIT range check (all-zero → null; bigint value >= curve order → null), same JWK/fingerprint construction including the WebCrypto importKey proof; deriveRoomSigningKey now just retries on null (behavior/determinism identical for valid scalars — verified by the existing task-19.4 suite plus the new range tests). TWO FACT CORRECTIONS vs the task brief: @noble/curves v2.4.0 exposes the order as p256.Point.CURVE().n (p256.CURVE.n is undefined in this version), and the importKey proof forces the function async (Promise<RoomSigningIdentity | null>). BigInt() constructor calls instead of literals — the repo targets ES2017 (tsconfig owned by another agent, untouched).
- DESIGN.md §6: added the missing localStorage residue inventory as a "What lingers on your device" bullet (room cards = metadata, creator tokens = burn authority, verification marks, per-room replay watermarks = seen-message counters for replay protection — non-secret residue that never leaves the device; keys/messages memory-only), plus the "Residuals closed in Task 22" note (leave requires proof-of-possession; room-info/verifier/members per-IP rate-limited; freshness-windowed soft cap with documented DoS residual). §5 server line updated to enumerate all per-IP limits.
- Verification: bunx vitest run → 92/92 green (74 pre-existing + 18 new, zero regressions); bun run lint → clean; bunx tsc --noEmit → zero errors in src/ (only the pre-existing examples/ + skills/ errors the spec filters out); dev.log clean, no service restarts.

Stage Summary:
- The unauthenticated POST /leave residual flagged by the Task 19-10 adversarial review ([P1]) is closed: a leave now requires a valid ECDSA signature from the member's own room key, idempotent on replay, rate-limited 20/min/IP.
- The existence/epoch oracle (GET room info, PUT verifier) and the registry write path (member join) are per-IP rate-limited (30/min and 12/min); the member cap is now a documented freshness-windowed soft cap with the policy centralized and property-tested in lib/admission.ts.
- Room identity derivation's scalar validity is an explicit, testable invariant ([1, n-1] checked as bigint) instead of a library throw.
- Test counts: 92 passed of 92 across 12 files. Files: created lib/leave-proof.ts, lib/admission.ts, three test files; edited room-protocol.ts, room-identity.ts, rate-limit.ts, app.ts (store), leave/route.ts, members/route.ts, [roomId]/route.ts, verifier/route.ts, rooms/route.ts, DESIGN.md.
- Behavior change the orchestrator must know: leaveRoom only performs the REST leave when a live cipher exists (unlocked room); a locked/refreshed tab skips REST and relies on the relay announce + silent-eviction grace, and a second valid leave for an already-inactive member no longer bumps the epoch.

---
Task ID: 22-c
Agent: general-purpose (legal)
Task: Legal work package — MIT LICENSE, Terms of Use + Privacy Policy (single source of truth in /public/legal), and their in-app presentation (legal-sheet.tsx wired into landing footer, Settings "About", and the app shell).

Work Log:
- Read worklog.md (Tasks 0–21) and DESIGN.md in full; cross-checked every claim in the documents against the real architecture (argon2id 64MB in-browser KDF, AES-256-GCM uniform padding, per-room ECDSA P-256, memory-only history, blind server inventory, relay stdout lines, silent-leaver grace, ±10-min replay residual, 12-member freshness-windowed soft cap, view-once-as-promise, immutable password).
- Created LICENSE — standard MIT, "Copyright (c) 2026 CipherChat Contributors".
- Created public/legal/terms.md (18 numbered sections, ~2,000 words): what CipherChat is/is not (not a hosted service provider; reference deployment), acceptance, eligibility (no under-13s; guardian consent), no-account/no-recovery model + immutable password, acceptable use, content-moderation reality under E2EE (operator cannot read ⇒ cannot moderate; no report button by design), ephemeral nature with NO destruction warranty (memory of other members, screenshots, view-once limits), self-hosting rights/duties under MIT, IP (user content stays the user's), AS-IS warranty disclaimer, liability cap at zero, indemnification, no SLA, export-controls notice, changes (no accounts ⇒ no notification channel), termination, "[Your Jurisdiction]" governing-law placeholder + no-governing-entity reference deployment, contact placeholder.
- Created public/legal/privacy.md (14 numbered sections, ~1,800 words): privacy architecture; the precise server inventory (room id, unreadable verifier blob, creator token, epoch counter, member registry fields); what never exists anywhere (content at rest, passwords, cross-room identities, analytics/cookies/third parties/ads); the full localStorage inventory with the "passwords and decrypted content are never written to disk" guarantee; how to delete everything (burn / clear site data + the honest limit); operator stdout join/leave lines; in-memory rate-limit counters; children; data security with the full honest residuals list; self-hosting = you are the data controller (upstream collects nothing); international-transfer note for self-hosters; policy changes; contact placeholder. Both docs reference "the published threat model in the repository (DESIGN.md)" and use calm, non-marketing language.
- Created src/components/cc/legal-sheet.tsx ("use client"): local zustand store useLegalSheet (open: "terms" | "privacy" | null, show, close); LegalLinks (two inline forest links, underline offset, hover states, keyboard-focusable, 150ms reduced-motion-safe color transitions, wraps at 360px); LegalSheetHost renders the open doc in the existing shadcn Sheet primitive (side bottom/right like SettingsSheet — centered modals are reserved for burn per DESIGN §4/file-viewer; near-full-screen h-[92dvh] on mobile, right sheet on desktop). Fetches /legal/*.md on open with a module-level cache; renders via react-markdown (v10 already in deps) with hand-styled components (no typography plugin): serif forest headings, max-w-prose serif body, hairline hr, mono code, semibold strong. Scroll region = max-h-[85vh] overflow-y-auto scroll-quiet overscroll-contain; header = t-title + "Last updated 2026-09-17" (mono, muted) + built-in 44px close; loading = mono "Fetching the document…" (role=status); error = neutral-charcoal message + SecondaryAction retry (render-time-adjustment pattern keeps react-hooks/set-state-in-effect clean — first attempt hit that lint rule and was restructured); footer = MIT-as-is line + quiet note pointing to the repository.
- Edited src/components/screens/landing.tsx — footer region only: LegalLinks under the trust-copy line at the same 11.5px scale (hero untouched).
- Edited src/components/cc/settings-sheet.tsx — "About" section (header styled like "People here", two 44px rows with chevron + hover wash calling showLegal("terms"|"privacy"), t-meta caption), placed after "People here"; the burn block keeps its mt-12 whitespace separation. One self-inflicted bug caught by tsc during the edit (my insert swallowed SettingsSheet's `export` keyword) — fixed immediately.
- Mounted <LegalSheetHost /> in src/components/cc/app.tsx next to SealingOverlay/BurnOverlay (the established global-overlay mount point) — diff kept to exactly two lines (import + element).
- Verified: eslint clean on all four touched files; `bunx tsc --noEmit` clean for src/ and public/ (remaining errors are pre-existing and unrelated: examples/websocket/server.ts socket.io types, skills/image-edit, skills/stock-analysis-skill — noted, not fixed per instructions). Dev server not restarted; no new npm dependencies (react-markdown was already installed).

Stage Summary:
- Legal single-source-of-truth shipped: public/legal/{terms,privacy}.md are detailed (18 + 14 numbered sections), factually tied to the real architecture and the DESIGN.md threat model (including the honest residuals), MIT LICENSE at the repo root.
- In-app reading surface shipped: legal-sheet.tsx (store + LegalLinks + LegalSheetHost), mounted once in app.tsx; entry points in the landing footer and the Settings "About" section; paper/forest styling, hairlines, scroll-quiet, keyboard-accessible Radix sheet, works at 360px.
- Deviations, deliberate: (1) used the Sheet primitive (bottom/right) instead of a centered Dialog because the design system reserves centered modals for the irreversible burn moment — mobile bottom sheet is h-[92dvh], i.e. effectively full-screen; (2) the sheet-footer repository note is styled link-like but is plain text — no canonical repository URL exists anywhere in the repo (package.json has no repository field), and a fake URL was worse than a typographic reference; (3) LICENSE was created per instructions even though another task may own it — if a conflict arises, the texts are identical standard MIT.
- Suggested follow-ups: link the docs from README.md (README owned by another task); if a canonical repo URL is ever decided, promote the footer note to a real anchor; operators self-hosting should be reminded (README/docs) to replace the "[Your Jurisdiction]" and contact placeholders in their own deployments.

---
Task ID: 22-d
Agent: frontend-styling-expert (logo system) + orchestrator finish
Task: Design "The Split Seal" brand mark and integrate it creatively across the UI; regenerate the icon set.

Work Log:
- Rewrote src/components/cc/mark.tsx: hand-tuned bezier wax-seal with a single -62° diagonal fracture; joint radii wobble (33.3/35.1 vs nominal 34) for a hand-pressed feel; split inner disc; ember glint in the fracture. Three variants: intact (seated offsets), cracked (halves jarred apart + ember flecks, animates once on mount), ring (single currentColor rim fragment for member inks/watermarks). Backwards-compatible props.
- globals.css: seal-stamp (landing press-in), reseal-stamp (rotation flash in chat header), seal-half-a/b break-apart, seal-glint flare, seal-fleck ember drifts — all in the app's existing motion register, reduced-motion safe.
- Integrations: landing hero stamps in then breathes; burn-overlay uses the cracked variant finale; chat-header re-stamps a small seal when the room key version bumps; bubble sender identity = 13px ring fragment in the sender's ink; room-list/chat empty states use low-opacity ring watermarks; sealing screen uses ring fragments as the argon2id "wax drip" dots; invite screen on the new mark.
- scripts/gen-icons.ts (bun + sharp) regenerated public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png and public/og.png (1200x630, seal + serif wordmark); public/icon.svg + logo.svg rewritten. Filenames kept stable so manifest/paths didn't move.
- Orchestrator finished the agent's timeout remainder: layout.tsx openGraph + twitter card metadata (og.png, 1200x630 + alt), apple icon switched to the dedicated 180px apple-touch-icon.png; verified PNG dimensions via sharp; lint + tsc + vitest all green.
- NOTE: the subagent hit a context deadline after completing the implementation but before verification/worklog; the orchestrator verified and closed it out.

Stage Summary:
- The generic concentric-circles seal is replaced everywhere by an authored mark whose fracture IS the product metaphor (E2EE seal + ephemerality crack + rotation re-stamp).
- Identity system: every member is a shard of the same broken ring, drawn in their deterministic ink — brand and protocol now speak the same visual language.
- Icon/PWA/OG assets regenerated from the same geometry (scripts/gen-icons.ts is rerunnable).

---
Task ID: 22-a / 22-e / 22-f
Agent: orchestrator (Z.ai Code)
Task: Task 20 "Exit the sandbox" — env/deploy/CI/SW layer (22-a), full two-origin QA (22-e), docs + handover (22-f). Reviewer's Task 20 = internal Task 22 (20/21 were taken by captions/reactions/silent-grace).

Work Log:
- 22-a CONFIG: src/lib/relay.ts now reads NEXT_PUBLIC_RELAY_URL (default same-origin "/relay/"); the hardcoded XTransformPort pattern moved to .env.local (sandbox-only, gitignored via .env* with new !.env.example exception). grep for XTransformPort/localhost:81 in src/ returns NOTHING (acceptance met). .env.example documents every variable (DATABASE_URL, RELAY_INTERNAL_TOKEN, NEXT_PUBLIC_RELAY_URL, NEXT_PUBLIC_SITE_URL).
- 22-a DEPLOY: deploy/{Dockerfile.web (multi-stage bun→node:22-slim, standalone output, prisma generate, baked empty-DB template + entrypoint volume-seeding), Dockerfile.relay (bun, copies index.ts + src/lib/rate-limit.ts preserving relative imports), docker-compose.yml (web + relay + caddy:2, RELAY_PRESENCE_URL=http://relay:3004 for the cross-container /evict consult, db-data volume), Caddyfile ({$CADDY_SITE} auto-TLS, handle_path /relay/* strips the prefix so the relay's path:"/" sees /?EIO=4 — websocket upgrades pass), deploy/.env.example}.
- 22-a CI: .github/workflows/ci.yml — bun install --frozen-lockfile → prisma generate → lint → tsc --noEmit → bun run test (92 property tests) → npm audit --audit-level=high (via npm install --package-lock-only; bun pm audit doesn't exist in this bun) → production build (DATABASE_URL=file:/tmp/ci.db, NEXT_PUBLIC_RELAY_URL=/relay/). tsconfig.json now excludes examples/ + skills/ (sandbox scaffolding was the only tsc noise; src/ is clean).
- 22-a SW UPDATE FLOW: public/sw.js → VERSION cipherchat-v3, /legal/ added to asset patterns, activate posts {type:"cipherchat:updated"} to all clients. sw-register.tsx registers with updateViaCache:"none" and shows ONE persistent sonner toast ("A fresh seal is ready", Reload action) on controllerchange-after-first-controller or the activate message — never auto-reloads (drafts live in memory).
- 22-a MISC: README "Running it" rewritten (two-terminal dev block fixed, production compose path, CI, performance note for argon2id on low-end Android, Legal section; deduped the doubled silent-grace table row; added departure-proof row). next.config.ts allowedDevOrigins = localhost, 127.0.0.1, *.space-z.ai (the sandbox preview proxy was getting /_next/* BLOCKED otherwise). layout.tsx metadataBase via NEXT_PUBLIC_SITE_URL + OG/Twitter cards pointing at /og.png. Removed relay-diag-tmp*.mjs junk from repo root.
- 22-e QA (agent-browser, two origins localhost:81 + 127.0.0.1:81, SWs unregistered first): full golden path PASSED — create room H4X31BGEY8 (A) → B joins via link+password (argon2id) → bidirectional messages (sender ring-fragment avatars confirmed in DOM) → **B leaves: POST /leave 200 with the NEW ECDSA departure proof, A shows "Faint Ibis left. The room re-sealed for those who remain."** → B rejoins after rotation (ECDH-wrapped key under entry key) → view-once file with caption A→B ("Opened — the contents are gone" spent state) → burn (both origins show "Burned — this room is gone"). Live relay log (/tmp/relay-supervised.log — note: mini-services/relay-service/relay.log is a STALE artifact of an older instance, pid 319 writes to /tmp) confirms join/leave/rejoin/burn lifecycle. Legal sheets verified: Terms (18 sections) + Privacy (15) fetch and render from /legal/*.md, close cleanly. Landing: seal stamps in then breathes, footer legal links present. Dark mode: html.dark, Nightfall tokens, seal re-inks to #4a6453. Mobile 390x780: footer pinned to bottom (footer.bottom == viewport height), no overflow. Zero console errors on both tabs; dev.log all-200s.
- 22-f DOCS: COMPONENTS.md — mark.tsx section rewritten for the Split Seal variants, sw-register.tsx update-flow section, new legal-sheet.tsx section. This entry closes Task 22.
- Verification summary: bun run lint clean; bunx tsc --noEmit clean (src/); bunx vitest run 92/92 across 12 files.

Stage Summary:
- The app is no longer sandbox-bound: one plain VPS + `docker compose up` in deploy/ yields a TLS site (Caddy auto-HTTPS, /relay/ prefix-strip proxying to the blind relay); all URLs and secrets are env-driven (.env.example is the contract); CI gates lint/types/92 property tests/audit/build.
- Task 19 acceptance residuals all closed: leave proof-of-possession (property-tested, idempotent replay), room-info/verifier/members per-IP rate limits, member cap as freshness-windowed soft cap (policy centralized in lib/admission.ts + tested), HKDF scalar range explicit ([1, n-1] bigint check, scalarToRoomIdentity), coordinator memberId confirmed server-issued cuid (not client-choosable — documented), replay watermark added to the DESIGN.md localStorage inventory, argon2d low-end expectation documented in README.
- Legal shipped: MIT LICENSE, public/legal/{terms,privacy}.md (18+14 sections, factually tied to the real architecture and threat model), in-app sheets from landing footer + Settings → About.
- Brand shipped: the Split Seal (intact/cracked/ring variants) integrated into hero stamp-in, burn finale, rotation re-stamp flash in the chat header, member identity ring fragments, empty-state watermarks, sealing wax-drip dots, regenerated PWA/apple/OG assets via scripts/gen-icons.ts.
- NOT done here (documented residuals): (1) Docker is unavailable in this sandbox, so the compose-build two-origin E2E could not be executed HERE — it must run once on any Docker host (README documents the exact golden path); dev-server two-origin E2E passed fully. (2) VLM feedback on the 512px icon: reads slightly "mechanical gasket" rather than waxy — acceptable for the stationery voice, but a future refinement could vary rim stroke thickness slightly / round the break ends. (3) `next.config.ts` still has typescript.ignoreBuildErrors:true — CI's explicit tsc step is the real gate; flipping the flag can be considered once CI runs for real. (4) relay.log staleness: the supervised relay writes to /tmp/relay-supervised.log; harmless, but a future round could repoint it.
- Priority recommendations for the next round: (a) run the compose-build E2E on a Docker host and fix whatever it surfaces (prisma engine tracing and sharp are the usual suspects); (b) push the repo to GitHub and watch the first real CI run; (c) optional polish: SW update-toast visual QA in a production build; (d) feature candidates from the backlog: presence-driven rotation grace tuning, relay join-member tokens, message search-within-room (local, memory-only), room member rename sync.

---
Task ID: 23
Agent: lead (Z.ai Code)
Task: Brand-new logo (The Vanishing Ink), creator-chosen room TTL (presets + custom + until-burned), and message TTL with seconds + custom lifetimes

Work Log:
- Logo — replaced "The Split Seal" with "The Vanishing Ink": a hand-fallen ink drop whose top frays into three rising flecks, the last one ember-warm. New mark.tsx exports InkMark (SealMark aliased) with variants intact/scattered/fleck/ghost (was intact/cracked/ring); all ~15 call sites updated (burn overlay → scattered, typing dots + sender shards → fleck, watermarks → ghost). CSS: seal-break/glint/fleck keyframes replaced by ink-lift-off (drop outline rests at 42% as a ghost of what burned), ember-flare, fleck-flee, and ink-rise (breathing flecks loop under .mark-breathe, reduced-motion guarded so flecks hold still). VLM-reviewed twice (first critique: flecks too small/clustered → enlarged to r 6.2/4.7/3.9, zigzag scatter, drop redrawn smaller, SEAT retuned) until "distinctive & non-generic, proceed with confidence".
- Brand assets — public/logo.svg + icon.svg rewritten; scripts/gen-icons.ts updated to the new geometry; PNGs regenerated via sharp (icon-192/512, maskable-512, apple-touch-180, og 1200×630 with wordmark + italic tagline). VLM-verified centering after one fix pass (drop mass at 46%/52% of tile).
- Message TTL — TtlChoice is now number (0=off); TTL_STEPS presets gained 15s/30s/1m; new TTL_MIN_SEC=5 / TTL_MAX_SEC=86400, isCustomTtl, clampTtl. format.ts: fmtTtlRemaining handles <60s ("42s") and days ("3d 04h"); new fmtTtlShort/fmtTtlLong. New shared TtlPicker (presets grid + custom editor with sec/min/hr units, live label, cap copy); composer's blind cycle button replaced by popover (desktop, via PopoverAnchor) / bottom sheet (mobile); settings default-lifetime grid now the same picker.
- Room TTL — Prisma Room.expiresAt (nullable = until burned); POST /api/rooms accepts ttlSec (5min–30d validated, default 24h, lazy-sweeps expired rooms on create); GET room info returns expiresAt and 404s {expired:true}; members/verifier/leave treat expired as gone; new PATCH /api/rooms/:id (creatorToken-gated, 410 on already-expired) lets the creator adjust later. Client: RoomCard.expiresAt/closed, RoomSession.expiresAt, store createRoom/joinRoom capture it, adjustRoomTtl + closeExpiredRoom actions, JoinResult "expired" reason with honest copy on join + unlock surfaces. UI: RoomTtlPicker in create sheet (24h/1h/7d/30d/Custom/Until-burned), invite sheet closing line, entry system line ("This room closes in X — then it's gone for everyone"), header countdown (terracotta under a minute), room-card "closes X" line, creator adjust in settings, in-chat expiry watcher (toast + navigate + "Closed — its time ran out" ash-style card, swept next load).
- Infra — db:push ran; dev-server daemonization fixed for this environment (double-fork supervisor at /tmp/cc-keepalive.sh; direct setsid/nohup children are reaped at tool-command teardown — the relay supervisor from a previous session survives the same way).

Stage Summary:
- All three user asks shipped and E2E-verified via agent-browser on the gateway origin (localhost:81): create with custom TTL (3min clamped to 5min minimum ✓), invite/system-line/header/card countdowns ticking ✓, 15s preset message burned in 15s ✓, custom 30s message burned ✓, room expired live → toast + navigation + closed card ✓, creator PATCH 1h → header "closes 59:58" ✓, until-burned room shows no clock ✓, burn overlay ghost mark VLM-verified ✓, expired room: GET 404 {expired}, join 404, PATCH 410, swept on next create ✓, mobile sheet pickers render ✓, expired-join copy on the invite screen ✓.
- tsc clean, eslint clean, 92/92 tests pass, dev.log clean, console free of runtime errors (one transient Radix dev warning not reproducible).
- Logo system is creatively integrated: typing dots are flecks, sender identities are flecks of the same vanishing ink in member colours, watermarks are drop ghosts, the seal-stamp entrance became the drop landing, burn leaves the drop's outline resting where the ink was.

---
Task ID: 24
Agent: lead (Z.ai Code)
Task: "Add cool animations to the UI and even the logo" — a full motion pass over The Vanishing Ink brand and every surface, with reduced-motion discipline held throughout.

Work Log:
- ENVIRONMENT REPAIR (blocking QA, found at round start): the sandbox was reset at 09:11 and `.env.local` — the sandbox-only relay URL — was never recreated, so every client fell back to same-origin `/relay/`, which the sandbox gateway does NOT forward: rooms could be created (REST) but no socket ever connected (composer stuck on "Reconnecting"). Fixed: `.env.local` recreated (NEXT_PUBLIC_RELAY_URL=/?XTransformPort=3003 + a fresh RELAY_INTERNAL_TOKEN); relay dev script now loads BOTH .env and .env.local (`bun --hot --env-file=../../.env --env-file=../../.env.local index.ts`) so the token reaches the relay and a future reset self-heals; relay restarted (handshake 200, presence endpoint 403/200 guard verified with/without the x-internal-token header). Also learned: Turbopack served a STALE compiled CSS after this session's edits (touch was not enough — an actual content change forces the recompile; if computed styles ever miss new rules, append a comment and reload).
- LOGO — the landing hero became a choreography (globals.css + landing.tsx + mark.tsx): the drop now FALLS (drop-land, 580ms: gravity easing in, squash at impact ~220ms, rebound, settle), the three flecks SPLASH upward on impact (fleck-splash, 460ms + staggered delays), a soft ink HALO bleeds outward beneath the mark (halo-bleed, radial forest stain, 800ms), then the existing evaporation loop takes over. The trick that makes it possible: fleck-splash drives the INDEPENDENT translate/scale CSS properties while ink-rise drives transform — two animations, disjoint properties, one element; per-fleck staggers moved from inline styles to numbered classes (.ink-fleck-1/2/3) because one inline animation-delay would bind every animation in a multi-animation shorthand.
- LOGO — at rest, hovering the hero mark lifts the flecks (-2.5px) and flares the ember (scale 1.4) via transitions on the same independent properties (450ms), so the loop never pauses.
- LOGO — ghost watermarks (empty desk, creator/joiner empty rooms) now DRAW THEMSELVES: ghost variant gained a `draw` prop (pathLength=1 normalized stroke-dash draw-on, 1.3s, flecks surfacing at 520/780ms), then drift almost imperceptibly forever (ghost-drift, 13s ±6px, 1.6s delayed).
- UI — screen transitions: every screen root (landing, invite, desk layout, chat ActiveRoom + LockedRoomView, desktop empty pane) takes its seat with screen-in (280ms fade + 10px rise); ChatScreen is now keyed by roomId so switching letters is switching pages (fresh scroll + entrance). The boot mark and the desktop empty-pane mark breathe.
- UI — messages arrive from the side they were written on: msg-in-self (from the right margin) / msg-in-other (from the left), 260ms, one soft overshoot — replacing the uniform rise.
- UI — the typing whisper: the three static dots are now three small flecks of the writer's ink rising and fading on a loop (whisper-fleck, 1.15s, staggered 200/400ms) — the mark's vanishing language, small enough to stay a whisper.
- UI — a TTL countdown in its final ten seconds breathes (ttl-final, 1s opacity pulse) on top of its terracotta colour.
- UI — dispatch flourish: two small flecks (one forest, one ember) rise from the send button as the letter leaves (send-burst pseudo-elements, 520ms, cleared by the pseudo's animationend landing on the button).
- UI — Nightfall arrives as a turn: the theme icon pair is keyed by resolved theme after hydration (useSyncExternalStore guard — no effect-setState, lint-clean) and the new icon swings in from -80° (theme-turn, 420ms).
- REGRESSION FOUND & FIXED (Task 23 fallout, caught by this round's E2E): every TTL room carries its entry system line ("This room closes in…"), so `messages.length === 0` was never true and BOTH empty states — the creator's "Invite someone to begin" (+ copy-invite CTA) and the joiner's "You won't see messages from before you joined" — plus their watermarks were dead in every TTL room (the default). Empty now means "no letters": system lines render above the empty state, which takes its seat around them.
- A11Y polish: the mobile TTL bottom sheet gained an sr-only SheetTitle + aria-describedby opt-out (kills the Radix DialogTitle error and Description warning — console now fully clean through the whole flow).
- next.config.ts: devIndicators:false — the Next dev-tools badge was overlapping the composer on small screens (VLM flagged it in every screenshot) and never exists in production.
- Reduced-motion discipline: every new animation degrades under prefers-reduced-motion (the landing splash disabled by class, whisper flecks static at 55%, drift/ttl-final disabled, halo loses its delay, everything else 150ms single fades via the existing global rule).
- Docs: DESIGN.md motion table rewritten for the full vocabulary (24 rows); COMPONENTS.md mark.tsx section was still describing the OLD Split Seal — rewritten for The Vanishing Ink with the draw prop and the hero choreography; theme-toggle section updated.

Stage Summary:
- E2E verified through the gateway (localhost:81) with a two-origin two-member run (B joined from 127.0.0.1:81): hero fall/splash/halo/hover all confirmed via computed styles AND VLM review ("Flawless execution"); msg-in-self + msg-in-other both directions; send-burst caught mid-flight; typing flecks ("Quiet Hare is writing…" with 3 whisper-flecks on the other origin); 15s TTL message counted down, pulsed under 10s, burned and vanished; empty states + watermark draw verified on creator, joiner, and after refresh+unlock; unlock sheet + mobile TTL sheet animate; theme turn caught mid-swing in dark mode; mobile 390px: footer pinned to the exact viewport bottom (780), no horizontal overflow; console and page errors fully clean.
- lint clean, tsc clean, 92/92 property tests pass, dev.log clean.
- Verification screenshots kept at /tmp/qa-24-*.png (landing mid-fall + settled, empty room, mobile landing/chat/TTL sheet, dark desktop, final desktop).
- Known residuals for the next round: (1) both old cron jobs (391228, 391768) are dead ("exec limits exceeded") — a fresh one is armed (392841, fixed_rate 900s); (2) relay now writes its log to /tmp/relay-qa.log (previous /tmp supervisors were wiped by the sandbox reset — if the sandbox resets again, start it with `cd mini-services/relay-service && bun run dev` in the background); (3) Task 20 residuals unchanged: compose-build E2E still needs a Docker host, first real CI run still pending, next.config.ts typescript.ignoreBuildErrors still true; (4) candidate next features: local message search-within-room, member rename sync, presence-driven rotation grace tuning, SW update-toast visual QA in a production build.
