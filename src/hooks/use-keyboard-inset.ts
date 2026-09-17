// The keyboard, made visible to CSS. Mobile browsers do not agree on
// what the on-screen keyboard does to the page: Android Chrome can
// resize the layout viewport (we ask for it via `interactive-widget=
// resizes-content`), but iOS Safari overlays it — fixed-position bottom
// sheets and dvh-tall shells stay put and the keyboard rises over
// whatever you were typing into.
//
// This hook publishes the keyboard's covered height as a single CSS
// custom property on <html>: `--kb-inset` (px). While no editable
// field is focused it stays 0px, so desktops and headless runs never
// see a false positive from URL-bar collapse.
//
// Consumed by: the app shell (padding-bottom lifts the composer and
// the message column) and every bottom Sheet (bottom offset + height
// cap). The math is the standard visual-viewport measurement:
//
//   inset = layoutViewportHeight - visualViewport.height - visualViewport.offsetTop
//
// On Android with resizes-content both terms shrink together, the
// inset reads ~0 and the native dvh resize does the work — the two
// mechanisms never double-count.

"use client";

import { useEffect } from "react";

const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true']";

function isEditable(el: Element | null): boolean {
  return !!el && !!el.closest?.(EDITABLE_SELECTOR);
}

export function useKeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    let editing = false;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const vv = window.visualViewport;
      if (!editing || !vv) {
        root.style.setProperty("--kb-inset", "0px");
        return;
      }
      // documentElement.clientHeight is the layout viewport height —
      // unlike window.innerHeight it does not shrink when iOS shows
      // the keyboard, which is precisely the difference we measure.
      const layoutH = root.clientHeight;
      const covered = layoutH - vv.height - vv.offsetTop;
      const max = Math.round(layoutH * 0.6);
      const inset = Math.max(0, Math.min(Math.round(covered), max));
      root.style.setProperty("--kb-inset", `${inset}px`);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target as Element | null)) {
        editing = true;
        schedule();
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      if (!isEditable(e.target as Element | null)) return;
      // Focus may be hopping straight to another editable field;
      // decide after the browser has settled the new activeElement.
      setTimeout(() => {
        editing = isEditable(document.activeElement);
        schedule();
      }, 0);
    };

    const onResize = () => {
      // Rotation, split-screen, or Android's native keyboard resize.
      editing = isEditable(document.activeElement);
      schedule();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", schedule);
    apply();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty("--kb-inset", "0px");
    };
  }, []);
}
