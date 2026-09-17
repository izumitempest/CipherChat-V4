// Capacitor configuration — the native-app wrapper.
//
// CipherChat's entire client is the deployed web app; Capacitor's job
// here is to frame that origin in a real Android/iOS shell (store
// distribution, native splash, proper window) without forking any
// code. Both packages are inert until `npx cap add …` generates the
// native projects — they add no build risk to the web app itself.
//
// The full pipeline (prerequisites, commands, signing, honest
// limitations) is documented in MOBILE.md.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.cipherchat.mobile",
  appName: "CipherChat",

  // Placeholder, deliberately: with `server.url` set below, Capacitor
  // loads the app over the network and webDir is only synced for
  // stray local assets (the config plumbing requires a directory to
  // exist — `public/` holds the PWA icons and splash PNGs, so it is a
  // truthful placeholder, not a bundled offline app). The day a
  // fully-offline shell is wanted, point a build output here and drop
  // `server.url`.
  webDir: "public",

  server: {
    // MUST be set to the deployed origin before `npx cap sync` —
    // export CIPHERCHAT_ORIGIN=https://chat.example.com
    // (remote-URL mode: the shell frames the live site; a stale or
    // placeholder origin yields a WebView that loads nothing).
    url: process.env.CIPHERCHAT_ORIGIN ?? "https://cipherchat.example.com",
    // HTTPS only. The app speaks TLS in production (Caddy handles it
    // at the edge); cleartext would undercut the whole premise.
    cleartext: false,
  },

  android: {
    // No mixed content, ever — same reasoning as cleartext above.
    allowMixedContent: false,
  },
};

export default config;
