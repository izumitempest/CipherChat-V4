// Registers the service worker — installability without retention.
// The worker itself caches only static shell assets; conversations
// never touch it (they never leave browser memory).
//
// Dev is exempt: hot-reload edits and a caching worker serve each
// other stale chunks, which has broken QA more than once.

"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (!("serviceWorker" in navigator)) return;
    const t = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Quiet by design — installability is an enhancement, never
         * a message the user needs to see. */
      });
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}
