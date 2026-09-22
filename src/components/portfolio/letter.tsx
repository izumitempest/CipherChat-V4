"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { InkMark } from "@/components/cc/mark";
import { ThemeToggle } from "@/components/cc/theme-toggle";
import { LegalLinks, LegalSheetHost } from "@/components/cc/legal-sheet";

/* ================================================================
 * THE FRONT ROOM — the public porch (Task 41).
 *
 * Round 3. The Letter's staging was itself the tell: a prop sheet
 * rotated on a desk, a struck-through word, doubled grain, a
 * sealing performance — authenticity theater, which is exactly
 * what generated pages perform now. Apple wouldn't stage a letter
 * on a desk; nobody at Google would rotate a card half a degree.
 *
 * So the porch performs nothing. The page IS the paper — flat,
 * centered, wearing the product's actual furniture: the app's own
 * header, its entrance, its breathing mark, its verb system, its
 * footer caption. Identifiability comes from what the product
 * already owns (paper, forest, the ink drop, the one aphorism),
 * never from an arrangement of props. Zero new CSS — every class
 * here is a house class.
 *
 * Doctrine (DESIGN.md §7): swap test, porch rule, one aphorism,
 * at most one gesture (this page chooses none), house verbs.
 * ================================================================ */

/* The live product, one dynamic import away. Invite links are
 * hash-routed (#/join/CODE) and the service worker's navigate
 * messages never round-trip the server — so the porch listens
 * for them itself and steps aside the moment one arrives. */
const CipherChatApp = dynamic(
  () => import("@/components/cc/app"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center bg-paper" />
    ),
  },
);

/* The porch's two egresses into the product. ?create=1 is
 * consumed by the app's landing (screens/landing.tsx), which
 * answers by having the form already out. */
const CREATE_HREF = "/?app=1&create=1#/new";
const JOIN_HREF = "/?app=1#/join";

/* The house verb system, as anchors — the same cut, height,
 * radius and sentence case the product's own buttons wear. */
const primaryVerbClass =
  "inline-flex h-12 w-full select-none items-center justify-center gap-2 rounded-[12px] bg-forest px-6 font-sans text-[14px] font-medium tracking-[0.01em] text-paper transition duration-150 hover:bg-forest-deep active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:w-auto";
const quietVerbClass =
  "inline-flex h-11 w-full select-none items-center justify-center rounded-[8px] px-3 font-sans text-[13.5px] font-medium text-mute transition-colors duration-150 hover:text-charcoal focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/25 sm:w-auto";
const cabinetLinkClass =
  "rounded-[4px] font-medium text-forest underline decoration-forest/30 underline-offset-[3px] transition-colors duration-150 hover:text-forest-deep hover:decoration-forest dark:text-forest-deep dark:hover:text-charcoal";

function Dot() {
  return (
    <span aria-hidden className="select-none text-mute">
      ·
    </span>
  );
}

export function LetterSite() {
  const [appRequested, setAppRequested] = useState(false);

  /* Hash routes belong to the product — hand off without a
   * server round-trip, exactly as the reader does. */
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#/")) setAppRequested(true);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (appRequested) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center bg-paper" />
        }
      >
        <CipherChatApp />
      </Suspense>
    );
  }

  return (
    /* The page is the paper. The app's own entrance, the app's
     * own grain (layout.tsx renders it for the whole world). */
    <div className="screen-in flex min-h-dvh flex-col bg-paper text-charcoal">
      {/* the same header the product's landing wears */}
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <span className="font-serif text-[18px] font-semibold tracking-[-0.01em]">
          CipherChat
        </span>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col items-center justify-center px-6 py-14 [@media(max-height:720px)]:py-8">
        <InkMark size={72} breathe />

        {/* The nbsp glues only "no trace." — the one true orphan.
            Greedy wrap then breaks "A conversation that / leaves
            no trace." evenly at porch widths, and stacks three
            clean lines on narrow phones. (text-balance is
            deliberately absent: with a glued chunk it picks the
            *worse* split — measured 370/496 vs greedy's 484/381.) */}
        <h1 className="mt-8 text-center font-serif text-[clamp(36px,5.4vw,54px)] font-semibold leading-[1.12] tracking-[-0.015em]">
          A conversation that leaves no&nbsp;trace.
        </h1>

        <p className="mt-6 max-w-[40ch] text-balance text-center font-sans text-[15px] leading-[1.65] text-mute sm:text-[16px]">
          A room is a link and a password. The server is a blind
          relay — it cannot read a single frame.
        </p>

        {/* the two verbs, in the house system */}
        <div className="mt-10 flex w-full max-w-[360px] flex-col items-center gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <a href={CREATE_HREF} className={primaryVerbClass}>
            Create a room
          </a>
          <a href={JOIN_HREF} className={quietVerbClass}>
            Join with a link or code
          </a>
        </div>

        <p className="mt-9 text-center font-sans text-[12px] leading-[1.6] text-mute">
          encrypted in your browser · nothing stored · burn&nbsp;when&nbsp;done
        </p>
      </main>

      {/* ——— the cabinet ———
          The porch keeps it shut: the reader, the legal documents,
          the operator's address. (README joins this line the day
          the repository is public — no link exists yet, and a dead
          one is a placeholder.) */}
      <footer className="mt-auto border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-3 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-5 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-sans text-[12.5px] leading-[1.5]">
            <a href="/?read=1#protocol" className={cabinetLinkClass}>
              Protocol
            </a>
            <Dot />
            <LegalLinks className="gap-x-2.5" />
            <Dot />
            <a
              href="mailto:abuse@cipherchat.app"
              className={cabinetLinkClass}
            >
              abuse@cipherchat.app
            </a>
          </div>
          <p className="font-sans text-[11px] leading-[1.5] tracking-[0.01em] text-mute">
            designed &amp; built by Okwuchukwu Ekene Don Davies —
            Izumi
            <span aria-hidden> · </span>
            MIT
          </p>
        </div>
      </footer>

      <LegalSheetHost />
    </div>
  );
}
