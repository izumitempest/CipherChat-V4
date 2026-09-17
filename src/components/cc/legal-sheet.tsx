// Legal — the Terms of Use and Privacy Policy, read in-app. The
// documents live in /public/legal as plain Markdown (single source of
// truth, readable on GitHub too); the sheet fetches and renders them.
// Not a centered modal — centered modals are reserved for irreversible
// moments — so this is a surface sheet like Room settings, near-full
// on a phone.

"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import Markdown, { type Components } from "react-markdown";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SecondaryAction } from "@/components/cc/actions";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Store — one open document, or none.                                 */
/* ------------------------------------------------------------------ */

export type LegalDoc = "terms" | "privacy";

export const useLegalSheet = create<{
  open: LegalDoc | null;
  show: (kind: LegalDoc) => void;
  close: () => void;
}>((set) => ({
  open: null,
  show: (kind) => set({ open: kind }),
  close: () => set({ open: null }),
}));

/* ------------------------------------------------------------------ */
/* Links — quiet inline references, forest like every trusted thing.   */
/* ------------------------------------------------------------------ */

const linkClass =
  "rounded-[4px] font-sans font-medium text-forest underline decoration-forest/30 underline-offset-[3px] transition-colors duration-150 hover:text-forest-deep hover:decoration-forest";

export function LegalLinks({ className, ...rest }: React.ComponentProps<"span">) {
  const show = useLegalSheet((s) => s.show);
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1",
        className,
      )}
    >
      <button type="button" className={linkClass} onClick={() => show("terms")}>
        Terms of Use
      </button>
      <span aria-hidden="true" className="select-none text-mute">
        ·
      </span>
      <button type="button" className={linkClass} onClick={() => show("privacy")}>
        Privacy Policy
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Host — mounts once, renders whichever document is open.             */
/* ------------------------------------------------------------------ */

const DOCS: Record<LegalDoc, { title: string; path: string }> = {
  terms: { title: "Terms of Use", path: "/legal/terms.md" },
  privacy: { title: "Privacy Policy", path: "/legal/privacy.md" },
};

// The documents are static — fetch each once per session.
const docCache = new Map<LegalDoc, string>();

export function LegalSheetHost() {
  const isDesktop = useIsDesktop();
  const open = useLegalSheet((s) => s.open);
  const close = useLegalSheet((s) => s.close);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Render-time adjustment (the codebase's sanctioned pattern, see
  // SettingsSheet): when the open document changes, adopt the cached
  // text — or clear it — before anything paints. No effect needed.
  const [wasOpen, setWasOpen] = useState<LegalDoc | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    setText(open ? (docCache.get(open) ?? null) : null);
    setFailed(false);
  }

  // The effect only ever talks to the network; state lands in the
  // promise callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (!open || docCache.has(open)) return;
    let cancelled = false;
    fetch(DOCS[open].path)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (cancelled) return;
        docCache.set(open, body);
        setText(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  return (
    <Sheet open={open !== null} onOpenChange={(v) => !v && close()}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-hairline bg-paper",
          isDesktop
            ? "w-full sm:max-w-[520px] md:rounded-l-[18px]"
            : "h-[92dvh] rounded-t-[18px] border-t",
        )}
      >
        {!isDesktop && <SheetGrabber />}

        <SheetHeader className="shrink-0 border-b border-hairline p-0 px-5 pb-4 pr-14 pt-4">
          <SheetTitle className="t-title">{open ? DOCS[open].title : ""}</SheetTitle>
          <SheetDescription className="font-mono text-[11px] tracking-[0.02em] text-mute">
            Last updated 2026-09-17
          </SheetDescription>
        </SheetHeader>

        <div className="scroll-quiet max-h-[85vh] min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-5">
          {failed ? (
            <div className="py-10 text-center">
              <p className="font-sans text-[13.5px] leading-[20px] text-charcoal/80">
                The document could not be fetched. Check your connection.
              </p>
              <SecondaryAction
                className="mt-4"
                onClick={() => {
                  setFailed(false);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </SecondaryAction>
            </div>
          ) : text === null ? (
            <p
              className="animate-pulse py-10 text-center font-mono text-[12px] tracking-[0.02em] text-mute"
              role="status"
            >
              Fetching the document…
            </p>
          ) : (
            <Markdown components={mdComponents}>{text}</Markdown>
          )}
        </div>

        <div className="mt-auto shrink-0 border-t border-hairline px-5 py-3.5">
          <p className="text-center font-sans text-[11px] leading-[16px] tracking-[0.01em] text-mute">
            CipherChat is offered as-is under the MIT license. The source,
            the license, and the published threat model (DESIGN.md) live in{" "}
            <span className="text-forest/80 underline decoration-forest/30 underline-offset-[3px]">
              the repository
            </span>
            .
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown styling — no typography plugin; every element is dressed   */
/* by hand. Serif for the human text, hairlines between the sections.  */
/* ------------------------------------------------------------------ */

const mdComponents: Components = {
  h1: ({ node, ...props }) => (
    <h1
      className="font-serif text-[19px] font-semibold leading-[26px] tracking-[-0.005em] text-forest"
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      className="mt-7 font-serif text-[16px] font-semibold leading-[22px] text-forest"
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      className="mt-5 font-serif text-[14.5px] font-semibold leading-[20px] text-charcoal"
      {...props}
    />
  ),
  p: ({ node, ...props }) => (
    <p
      className="mt-3 max-w-prose font-serif text-[14px] leading-[21px] text-charcoal/85"
      {...props}
    />
  ),
  ul: ({ node, ...props }) => (
    <ul
      className="mt-3 max-w-prose list-disc space-y-1.5 pl-5 font-serif text-[14px] leading-[21px] text-charcoal/85"
      {...props}
    />
  ),
  ol: ({ node, ...props }) => (
    <ol
      className="mt-3 max-w-prose list-decimal space-y-1.5 pl-5 font-serif text-[14px] leading-[21px] text-charcoal/85"
      {...props}
    />
  ),
  li: ({ node, ...props }) => <li className="[&>p]:mt-1.5" {...props} />,
  strong: ({ node, ...props }) => (
    <strong className="font-semibold text-charcoal" {...props} />
  ),
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  hr: ({ node, ...props }) => <hr className="my-8 border-t border-hairline" {...props} />,
  code: ({ node, ...props }) => (
    <code
      className="rounded-[4px] border border-hairline bg-side px-1 py-px font-mono text-[12px] text-charcoal"
      {...props}
    />
  ),
  a: ({ node, ...props }) => (
    <a
      className="font-medium text-forest underline decoration-forest/30 underline-offset-2 transition-colors duration-150 hover:decoration-forest"
      {...props}
    />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="mt-3 border-l-2 border-forest/25 pl-4 font-serif text-[14px] leading-[21px] text-charcoal/70 italic"
      {...props}
    />
  ),
};
