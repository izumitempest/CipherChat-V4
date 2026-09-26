import { defineConfig } from "@playwright/test";

// The E2E golden path runs against a REAL stack, never a mock:
//
//   locally:   the dev server + relay behind the sandbox gateway
//              (http://127.0.0.1:81), because the socket.io path only
//              routes through the gateway origin here.
//   in CI:     the production compose stack (web + relay + Caddy) on
//              the Actions runner, via E2E_BASE_URL=http://localhost
//              with CADDY_SITE=http://localhost (plain HTTP on :80).
//
// Two browser contexts, same origin: contexts have isolated storage,
// which retires the two-origins trick the manual QA needed (tabs share
// localStorage; contexts don't).

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:81",
    // The golden path tests conversation logic, not the service
    // worker's lifecycle. A fresh profile's first install raced the
    // "new version installed" toast over the message list and
    // intercepted the reply click (CI run #6); blocking removes the
    // whole class of timing flakiness. The update-prompt behavior
    // itself is a first-install-silent design in sw-register.tsx.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 }, // desktop affordances (hover reply, header icons)
    actionTimeout: 15_000,
  },
  outputDir: "./test-results",
});
