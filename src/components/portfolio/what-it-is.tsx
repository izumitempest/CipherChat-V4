"use client";

import { Section } from "./section";

/* What it is — the idea in the product's own three verbs, then
 * the short list of what that buys you. Plain headings, plain
 * sentences, Inter labels in sentence case. */

const MOVES = [
  {
    title: "Create",
    body: "A room is a link and a password, both generated randomly. Share them through different channels — the link is the address, the password is the key. No account to make, no invite to accept, no roster with your name on it.",
  },
  {
    title: "Talk",
    body: "Every message, file and reaction is signed and encrypted in your browser, then padded to a uniform size. The server relays frames it cannot read — it can't tell typing from messages, or read a file's size.",
  },
  {
    title: "Burn",
    body: "Messages delete themselves on their own countdown, and rooms expire on theirs. Anyone in the room can burn it for everyone — and new joiners see nothing from before they joined.",
  },
] as const;

const CAPABILITIES = [
  ["No accounts", "A room is a link and a password, both randomly generated."],
  ["Ephemeral by default", "Message timers from 15 seconds to 8 hours; room lifetimes up to a day."],
  ["Uniform frames", "Every frame is the same size; every file becomes the same number of chunks."],
  ["Keys live in memory", "Reload the page and every room locks — the key never touches storage."],
  ["Ink marks", "Acknowledged, noted, warmly received, later — encrypted, signed, uniform-sized."],
  ["Derived identity", "An alias and a verifiable fingerprint per room; per-room keys make you unlinkable."],
  ["Location stripping", "Photos whose EXIF metadata cannot be stripped do not get sent."],
  ["Installable, self-hostable", "Installs from the browser; on your own server it's one token and one hostname."],
] as const;

export function WhatItIs() {
  return (
    <Section
      id="what"
      title="What it is"
      lede="A room is a link and a password — that pair is the whole account. CipherChat is for secure first contact: a private channel you can open right now, with someone you'll verify another way."
    >
      <div className="space-y-8">
        {MOVES.map((move) => (
          <div key={move.title}>
            <h3 className="font-serif text-[19px] font-semibold leading-[1.3]">
              {move.title}
            </h3>
            <p className="mt-2 max-w-[62ch] font-sans text-[14.5px] leading-[1.7] text-charcoal/85">
              {move.body}
            </p>
          </div>
        ))}
      </div>

      <dl className="mt-12 border-t border-hairline">
        {CAPABILITIES.map(([term, body]) => (
          <div
            key={term}
            className="grid gap-1 border-b border-hairline py-3.5 sm:grid-cols-[220px_1fr] sm:gap-6"
          >
            <dt className="font-sans text-[13px] font-medium text-charcoal">
              {term}
            </dt>
            <dd className="font-sans text-[13.5px] leading-[1.6] text-charcoal/85">
              {body}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
