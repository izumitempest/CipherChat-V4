// The install offer, made polite. The browser fires
// `beforeinstallprompt` when it is willing (Android Chrome, desktop
// Chrome/Edge); we catch it, keep it, and let OUR UI make the ask,
// never the browser's mini-infobar. iOS Safari never fires it: there,
// installing is a hand movement (Share → Add to Home Screen), so the
// settings sheet teaches the steps instead.
//
// `standalone` knows whether this IS already the installed app (the
// sheet then says so, and stops offering). Platform facts are read
// through useSyncExternalStore: no effect-setState, no hydration
// guesswork (the same discipline as the theme toggle).

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const emptySubscribe = () => () => {};

function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  // iPadOS masquerades as macOS; touch points give it away.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

const STANDALONE_MQ = "(display-mode: standalone)";

function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia(STANDALONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE_MQ).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt() {
  const isIos = useSyncExternalStore(
    emptySubscribe,
    isIosDevice,
    () => false,
  );
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    getStandalone,
    () => false,
  );

  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Keep the browser's own banner quiet; our sheet does the asking.
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return false;
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      setInstallEvent(null);
      return outcome === "accepted";
    } catch {
      return false;
    }
  }, [installEvent]);

  return {
    canPrompt: !!installEvent,
    isIos,
    standalone,
    installed,
    promptInstall,
  };
}
