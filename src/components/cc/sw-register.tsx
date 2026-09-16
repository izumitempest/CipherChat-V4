// Registers the service worker — installability without retention.
// The worker itself caches only static shell assets; conversations
// never touch it (they never leave browser memory).

"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
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
