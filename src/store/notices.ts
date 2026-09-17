// The banner stack — in-app notices while the user is elsewhere in
// the app. One notice per room (a room that speaks again replaces
// its banner and resets its clock); at most three on stage, the
// oldest stepping off first.
//
// Removal is a two-step bow: `dismiss` marks the banner leaving (the
// component plays notice-close), `remove` takes it off stage once the
// animation ends. Timers live here, not in the component, so a
// remount never freezes a banner on screen.

"use client";

import { create } from "zustand";
import type { IncomingNotice } from "@/lib/notifications";

export interface BannerNotice extends IncomingNotice {
  /** Stable per room — a room speaking again keeps its seat. */
  key: string;
  at: number;
  leaving?: boolean;
}

interface NoticeState {
  banners: BannerNotice[];
  push: (n: IncomingNotice) => void;
  /** Begin the exit animation (idempotent). */
  dismiss: (key: string) => void;
  /** Actually remove — called on the exit animation's end. */
  remove: (key: string) => void;
}

const MAX_BANNERS = 3;
const BANNER_TTL_MS = 6500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(key: string) {
  const t = timers.get(key);
  if (t) {
    clearTimeout(t);
    timers.delete(key);
  }
}

export const useNoticeStack = create<NoticeState>((set, get) => ({
  banners: [],

  push: (n) => {
    const key = `room-${n.roomId}`;
    const banner: BannerNotice = { ...n, key, at: Date.now() };
    set((s) => {
      // Same room speaking again: replace in place, keep its seat.
      const without = s.banners.filter((b) => b.key !== key);
      const next = [banner, ...without];
      // The stage holds three; the oldest bows out immediately.
      const overflow = next.slice(MAX_BANNERS);
      for (const dropped of overflow) clearTimer(dropped.key);
      return { banners: next.slice(0, MAX_BANNERS) };
    });
    clearTimer(key);
    timers.set(
      key,
      setTimeout(() => get().dismiss(key), BANNER_TTL_MS),
    );
  },

  dismiss: (key) => {
    set((s) => {
      const target = s.banners.find((b) => b.key === key);
      if (!target || target.leaving) return s; // nothing to bow out
      return {
        banners: s.banners.map((b) =>
          b.key === key ? { ...b, leaving: true } : b,
        ),
      };
    });
    clearTimer(key);
  },

  remove: (key) => {
    clearTimer(key);
    set((s) => ({ banners: s.banners.filter((b) => b.key !== key) }));
  },
}));
