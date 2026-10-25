"use client";

import { useSyncExternalStore } from "react";

/* Reduced motion, read the hydration-safe way: the server says
 * false, the client reads its own media query, and
 * useSyncExternalStore reconciles them without a mismatch or a
 * flash. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
