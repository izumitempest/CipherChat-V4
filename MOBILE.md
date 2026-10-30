# CipherChat on mobile

CipherChat is a PWA first. It installs from the browser, runs in its own
window and keeps its offline shell, no store account needed. For store
distribution, `capacitor.config.ts` plus the pipeline below wrap the
deployed site in a real Android or iOS shell. This document is the
handover for both paths.

---

## 1. Install as a PWA, works today

### Android, Chrome

1. Open the site in Chrome. Any Chromium browser works, the flow below
   is Chrome's.
2. Menu **⋮ → Install app**. Older versions say Add to Home screen.
3. Confirm. The app appears on the home screen and in the app drawer
   with the Vanishing Ink icon.

### iOS, Safari

1. Open the site in Safari. The install flow is Safari's, and pages
   opened inside another app's in-app browser cannot install.
2. Tap the **Share** button, the square with an arrow.
3. Scroll down and choose **Add to Home Screen**.
4. Confirm the name, CipherChat, and tap **Add**.

### What you get

- A standalone window. No browser chrome, the paper canvas edge to edge,
  its own card in the task switcher. The manifest declares
  `display: standalone`. The launch image is the Vanishing Ink seated on
  paper, per-resolution PNGs in `public/splash/`, wired through
  `src/components/cc/apple-splash.tsx`.
- The offline shell. The service worker caches the static app shell, so
  opening the app with no connection shows the desk rather than the
  browser's offline page. Conversations never touch the cache. They
  live in memory or nowhere.
- Local notifications while the app is alive. Backgrounded but resident,
  the app can raise a local notification, a letter arrived or a room
  burned. Section 3 says how far that reaches.
- The badge, where the platform allows it.

## 2. The Capacitor pipeline, store builds

The web app is the product. Capacitor frames the deployed origin in a
native shell so it can ship through the Play Store and the App Store.
`@capacitor/core` and `@capacitor/cli` are installed and inert, and
nothing changes for the web build until you run the commands below.

One thing worth knowing before you start: those packages ship in
`dependencies` and are flagged for removal in bugs/BUGS.md B40, because
nothing in `src/` imports them. The pipeline still works when you run
it, it just is not load-bearing for the web app.

### Prerequisites

- Both platforms: the site deployed and reachable over HTTPS, see
  `deploy/`, and `bun` or npm working in this repo.
- Android: Android Studio with an installed SDK platform, API 34 or
  later, and its bundled JDK.
- iOS: a Mac with Xcode, plus an Apple Developer Program membership for
  anything beyond a personal device.
- Store accounts: Google Play Console, one-time fee, and or App Store
  Connect.

### Generating the native projects

```bash
export CIPHERCHAT_ORIGIN=https://chat.example.com   # your deployed origin, required

npx cap add android        # creates android/
npx cap add ios            # creates ios/, macOS only
npx cap sync               # pushes config + webDir into the native projects
npx cap open android       # opens Android Studio, or: npx cap open ios
```

`capacitor.config.ts` runs the shell in remote-URL mode, so the WebView
loads `CIPHERCHAT_ORIGIN` directly and a store release is always the
currently deployed web app. `cleartext` and `allowMixedContent` are off
by policy. The app speaks TLS only.

### Icons and splash inside the shell

Capacitor uses its own asset pipeline, separate from the web PWA's
`public/icons/` and `public/splash/`.

```bash
mkdir -p assets    # repo root
# assets/icon.png    1024×1024, the mark on paper. Re-run
#                                 scripts/gen-icons.ts at 1024
# assets/splash.png  2732×2732, the mark + wordmark on paper.
#                                 scripts/gen-splash.ts at square
npx @capacitor/assets generate --android --ios
```

### Signing and release, outline

Android. Create a keystore you will keep forever,
`keytool -genkeypair -v -keystore cipherchat.keystore …`, wire it into
`android/gradle.properties` and the app build.gradle as a
`signingConfig`, keep the keystore and passwords out of the repo, then
run `./gradlew bundleRelease` inside `android/` for an `.aab`. Upload to
the Play Console through an internal-testing track first.

iOS. With the team selected in Xcode's Signing and Capabilities,
Archive then Distribute App then App Store Connect. TestFlight before
the store. Plan for the review description to say plainly what the app
is: an end-to-end-encrypted, ephemeral chat with no accounts. Reviewers
read `public/legal/` too.

## 3. Known limitations

Read this before promising anything. Same rule as the README.

- There is no web push, no VAPID, by architecture. Push notifications
  are delivered by a push service, Apple's or Google's, on the sender's
  behalf, which means someone has to hand that service a payload before
  delivery. Our relay is blind and in-memory and never holds room keys,
  so it cannot compose an encrypted payload, and a plaintext payload
  would hand message contents to the push provider. The consequence is
  simple: no notification about a message arrives unless the app is
  running.
- Local notifications fire only while the app process is alive. A
  backgrounded-but-resident PWA, or a Capacitor shell, can raise them.
  iOS suspends and eventually purges background tabs, and Android
  bounds their lifetime. Treat notifications as best-effort presence,
  not as delivery.
- The Capacitor shell is a frame, not a bundle. In remote-URL mode the
  app needs the deployed origin to be up, and its offline behaviour is
  exactly the web app's offline shell, nothing more.
- Apple's App Store may say no. Guideline 4.2, minimum functionality,
  rejects apps that read as little more than a wrapped website, and a
  remote-URL Capacitor build is exactly that shape. The review risk is
  real. If the App Store refuses, the iOS fallback is the PWA install
  path in section 1: the same app on the home screen, without a store
  listing.
- The iOS splash is per-resolution. The 13 PNGs in `public/splash/`
  cover every current iPhone and iPad, and a future screen size falls
  back to the plain paper background. Same colour, so the fallback is
  unobtrusive.

### What web push would take, future work

Sketched, not scheduled. Each step has a privacy cost that has to be
paid knowingly.

1. A VAPID keypair on the server tier, and the push subscription
   recorded when a member joins. The server would then retain device
   endpoints, which is retained metadata the privacy policy must
   disclose.
2. An end-to-end encrypted notification stub. The sending client derives
   a per-recipient notification key over the channel ECDH pair already
   established at join, so only the recipient's service worker can open
   the payload. Even then the payload should carry no content, "a letter
   arrived", never the words.
3. A `push` handler in `sw.js` that decrypts the stub and shows the
   alert.

One residual remains even then: a content-free push still tells the push
service when traffic happens. The relay already sees timing, the push
infrastructure currently does not. That is the trade.

Also worth flagging, and separate from all of the above: `start-dev.sh
--lan` serves the app and the relay over plain HTTP on a LAN IP.
SubtleCrypto wants a secure context and an arbitrary LAN IP over HTTP is
not reliably one, so the first crypto call fails on a phone and the
service worker never installs. Use HTTPS for LAN testing. See
bugs/BUGS.md B44.

---

Asset sources: `scripts/gen-icons.ts` for icons, apple-touch and OG,
and `scripts/gen-splash.ts` for the iOS launch images. Both compose the
same SVG geometry the app renders. Re-run them, never edit the PNGs.
