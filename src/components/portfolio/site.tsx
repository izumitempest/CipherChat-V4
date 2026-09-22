"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SECTIONS } from "./section";
import { WhatItIs } from "./what-it-is";
import { CipherPlayground } from "./cipher-playground";
import { Lifecycle } from "./lifecycle";
import { Protocol } from "./protocol";
import { Limits } from "./limits";
import { Stack } from "./stack";
import { Author } from "./author";
import { ThemeToggle } from "@/components/cc/theme-toggle";

/* The live product, one dynamic import away. Invite links are
 * hash-routed (#/join/CODE) and the service worker's navigate
 * messages never round-trip the server — so this face listens for
 * them itself and steps aside the moment one arrives. */
const CipherChatApp = dynamic(
  () => import("@/components/cc/app"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center bg-paper" />
    ),
  },
);

const egressClass =
  "inline-flex items-center gap-1 rounded-[4px] font-sans text-[13px] font-medium text-forest underline decoration-forest/30 underline-offset-[3px] transition-colors duration-150 hover:text-forest-deep hover:decoration-forest focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 dark:text-forest-deep dark:hover:text-charcoal";

export function ReaderSite() {
  const [appRequested, setAppRequested] = useState(false);

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
    <div className="screen-in flex min-h-dvh flex-col bg-paper text-charcoal">
      {/* the same header the product and the porch wear */}
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <a
          href="/"
          className="font-serif text-[18px] font-semibold tracking-[-0.01em] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40"
        >
          CipherChat
        </a>
        <div className="flex items-center gap-4">
          <a href="/?app=1" className={`${egressClass} hidden sm:inline-flex`}>
            Open the app
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[688px] flex-1 px-6">
        {/* the document's opening — a title, a paragraph, the
            contents. Nothing else. */}
        <div className="pb-12 pt-12 sm:pb-16 sm:pt-16">
          <h1 className="font-serif text-[clamp(32px,4.6vw,44px)] font-semibold leading-[1.12] tracking-[-0.012em]">
            How CipherChat works
          </h1>
          <p className="mt-5 max-w-[58ch] font-sans text-[15.5px] leading-[1.7] text-mute sm:text-[16.5px]">
            What it does, how the encryption works, and what it does not
            protect against. The source is public and MIT-licensed — every
            claim on this page can be checked against it.
          </p>
          <nav
            aria-label="On this page"
            className="mt-8 border-y border-hairline py-3.5"
          >
            <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-sans text-[13px]">
              {SECTIONS.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <span aria-hidden className="text-mute">
                      ·
                    </span>
                  ) : null}
                  <a
                    href={`#${s.id}`}
                    className="rounded-[4px] font-medium text-forest transition-colors duration-150 hover:underline hover:text-forest-deep focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 dark:text-forest-deep dark:hover:text-charcoal dark:hover:underline"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <WhatItIs />
        <CipherPlayground />
        <Lifecycle />
        <Protocol />
        <Limits />
        <Stack />
        <Author />
      </main>

      {/* the document's last line */}
      <footer className="mt-auto border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[688px] flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-5 text-center font-sans text-[12.5px]">
          <a href="/" className={egressClass}>
            CipherChat
          </a>
          <span aria-hidden className="text-mute">
            ·
          </span>
          <a href="/?app=1" className={egressClass}>
            Open the app
          </a>
          <span aria-hidden className="text-mute">
            ·
          </span>
          <a href="mailto:abuse@cipherchat.app" className={egressClass}>
            abuse@cipherchat.app
          </a>
        </div>
      </footer>
    </div>
  );
}
