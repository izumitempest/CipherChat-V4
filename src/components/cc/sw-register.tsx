// Registers the service worker — installability without retention.
// The worker itself caches only static shell assets; conversations
// never touch it (they never leave browser memory).
//
// Dev is exempt: hot-reload edits and a caching worker serve each
// other stale chunks, which has broken QA more than once.
//
// Update flow (Task 22): when a freshly deployed worker takes over,
// the page shows ONE persistent toast offering a reload. It never
// reloads on its own — a half-written draft outranks freshness.

"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (!("serviceWorker" in navigator)) return;

    // The page already had a controller when it loaded → any LATER
    // controllerchange is an update, not the first install.
    let hadController = !!navigator.serviceWorker.controller;
    let prompted = false;

    const onControllerChange = () => {
      if (!hadController) {
        hadController = true; // first install claiming the page — silent
        return;
      }
      if (prompted) return; // one prompt per page load
      prompted = true;
      toast("A fresh seal is ready", {
        description:
          "A new version of CipherChat is installed. Reload when your letters are safely sent — drafts are kept only in memory.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => window.location.reload(),
        },
      });
    };

    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "cipherchat:updated" && !prompted && hadController) {
        // Belt and braces: the activate message arrives even if the
        // controllerchange race was lost.
        prompted = true;
        toast("A fresh seal is ready", {
          description:
            "A new version of CipherChat is installed. Reload when your letters are safely sent — drafts are kept only in memory.",
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => window.location.reload(),
          },
        });
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);

    const t = setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          /* Quiet by design — installability is an enhancement, never
           * a message the user needs to see. */
        });
    }, 1200);

    return () => {
      clearTimeout(t);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
    };
  }, []);
  return null;
}
