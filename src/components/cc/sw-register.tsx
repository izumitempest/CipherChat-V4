// Registers the service worker — installability without retention.
// The worker itself caches only static shell assets; conversations
// never touch it (they never leave browser memory).
//
// Dev is exempt from REGISTRATION: hot-reload edits and a caching
// worker serve each other stale chunks, which has broken QA more
// than once. The message ROUTES below stay attached in every
// environment — they are inert without a worker.
//
// Update flow (Task 22): when a freshly deployed worker takes over,
// the page shows ONE persistent toast offering a reload. It never
// reloads on its own — a half-written draft outranks freshness.
//
// Notification taps (Task 25): the worker (or the page-level
// notification fallback) asks for a room; the hash router opens it —
// locked rooms show their unlock sheet, which is a first-class state.

"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useApp } from "@/store/app";

export function SwRegister() {
  useEffect(() => {
    /* ---- Routes (every environment) ---- */

    const openRoom = (roomId: unknown) => {
      if (typeof roomId !== "string" || !roomId) return;
      useApp.getState().navigate("chat", roomId);
    };

    // A tapped service-worker notification: focus happened in the
    // worker; we just take the seat it named.
    const onRouteMessage = (event: MessageEvent) => {
      if (event.data?.type === "cipherchat:navigate") {
        openRoom(event.data.roomId);
      }
    };

    // The page-level notification fallback (no worker registered):
    // it focused the window, then named the room.
    const onOpenRoom = (event: Event) => {
      openRoom((event as CustomEvent<{ roomId?: string }>).detail?.roomId);
    };

    navigator.serviceWorker?.addEventListener("message", onRouteMessage);
    window.addEventListener("cc:open-room", onOpenRoom);

    /* ---- Update prompt + registration (production only) ---- */

    // The page already had a controller when it loaded → any LATER
    // controllerchange is an update, not the first install.
    let hadController = !!navigator.serviceWorker?.controller;
    let prompted = false;

    const offerReload = () => {
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

    const onControllerChange = () => {
      if (!hadController) {
        hadController = true; // first install claiming the page — silent
        return;
      }
      if (prompted) return; // one prompt per page load
      prompted = true;
      offerReload();
    };

    // Belt and braces for the update prompt: the worker's activate
    // message arrives even if the controllerchange race was lost.
    const onUpdateMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "cipherchat:updated" &&
        !prompted &&
        hadController
      ) {
        prompted = true;
        offerReload();
      }
    };

    if (process.env.NODE_ENV !== "development") {
      navigator.serviceWorker?.addEventListener(
        "controllerchange",
        onControllerChange,
      );
      navigator.serviceWorker?.addEventListener("message", onUpdateMessage);

      const t = setTimeout(() => {
        navigator.serviceWorker
          ?.register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch(() => {
            /* Quiet by design — installability is an enhancement, never
             * a message the user needs to see. */
          });
      }, 1200);

      return () => {
        clearTimeout(t);
        navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
        navigator.serviceWorker?.removeEventListener("message", onUpdateMessage);
        navigator.serviceWorker?.removeEventListener("message", onRouteMessage);
        window.removeEventListener("cc:open-room", onOpenRoom);
      };
    }

    return () => {
      navigator.serviceWorker?.removeEventListener("message", onRouteMessage);
      window.removeEventListener("cc:open-room", onOpenRoom);
    };
  }, []);
  return null;
}
