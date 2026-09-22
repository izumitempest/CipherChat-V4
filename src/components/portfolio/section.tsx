import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* The protocol page's table of contents: one source for the
 * "On this page" line and nothing else. Plain labels, sentence
 * case, stable ids (the landing links to #protocol). */
export const SECTIONS = [
  { id: "what", label: "What it is" },
  { id: "demo", label: "A live example" },
  { id: "life", label: "How a room works" },
  { id: "protocol", label: "The protocol" },
  { id: "limits", label: "Limits" },
  { id: "stack", label: "How it's built" },
  { id: "author", label: "The author" },
] as const;

/* Every section of the document shares this scaffold: a hairline
 * rule above, a Lora heading, an optional lede in Inter. No
 * numbers, no kickers: a heading says what the section is. */
export function Section({
  id,
  title,
  lede,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 border-t border-hairline py-12 sm:py-16",
        className,
      )}
    >
      <header>
        <h2 className="font-serif text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] sm:text-[30px]">
          {title}
        </h2>
        {lede ? (
          <p className="mt-4 max-w-[62ch] font-sans text-[15px] leading-[1.7] text-mute">
            {lede}
          </p>
        ) : null}
      </header>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}
