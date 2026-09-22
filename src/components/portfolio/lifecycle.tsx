"use client";

import { Section } from "./section";

/* How a room works — five steps, as a plain ordered list. Every
 * step is on the page at once, because a document is scannable. */

const STEPS = [
  {
    title: "Create",
    body: "A room is minted: a random link and a random password. Share them through different channels — the link is routing, the password is the room.",
  },
  {
    title: "Unlock",
    body: "Your browser stretches the password with argon2id — 64 MB of memory — into the entry key. The key is derived, used and kept in memory: never transmitted, never stored.",
  },
  {
    title: "Talk",
    body: "Messages, files, reactions, ink marks — signed, padded, sealed. The relay forwards uniform frames it cannot read, cannot size, and cannot tell apart.",
  },
  {
    title: "Leave",
    body: "Leaving seals the room under a fresh random key, delivered pairwise over ephemeral ECDH — never derived from the password. A silent leaver is written out after a two-minute grace.",
  },
  {
    title: "Burn",
    body: "Timers delete messages on their own clocks, and rooms expire on theirs. Anyone in the room can burn it for everyone — no appeals, no undo.",
  },
] as const;

export function Lifecycle() {
  return (
    <Section
      id="life"
      title="How a room works"
      lede="Every room goes through the same five steps, in the same order."
    >
      <ol className="border-t border-hairline">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="grid gap-1.5 border-b border-hairline py-5 sm:grid-cols-[44px_1fr] sm:gap-4"
          >
            <span
              aria-hidden
              className="font-sans text-[13px] font-medium tabular-nums text-mute sm:pt-0.5"
            >
              {i + 1}.
            </span>
            <div>
              <h3 className="font-serif text-[17px] font-semibold leading-[1.3]">
                {step.title}
              </h3>
              <p className="mt-1.5 max-w-[62ch] font-sans text-[14px] leading-[1.7] text-charcoal/85">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
