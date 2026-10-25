"use client";

import { Section } from "./section";

/* What it is: the idea in the product's own three verbs, then
 * the short list of what that buys you. Plain headings, plain
 * sentences, Inter labels in sentence case. */

const MOVES = [
  {
    title: "Create",
    body: "The link and the password are both generated at random. Share them through different channels. There is no account to create and no invite to accept. The server keeps a list of member public keys, not names.",
  },
  {
    title: "Talk",
    body: "Messages, files, and reactions are signed and encrypted in the browser before they are sent. Every frame is padded to the same size. The server forwards the frames without seeing their content, and cannot tell a message from a typing indicator or measure a file.",
  },
  {
    title: "Burn",
    body: "Messages can be set to delete themselves after a fixed time. Rooms can also be set to expire. Any member can burn the room, which ends it for everyone. New joiners never see messages from before they joined.",
  },
] as const;

const CAPABILITIES = [
  ["No accounts", "A room is a link and a password, both generated at random."],
  ["Ephemeral by default", "Message timers from 5 seconds to 24 hours. Room lifetimes from minutes to 30 days, or until burned."],
  ["Uniform frames", "Every frame is the same size. Every file uses the same number of chunks."],
  ["Keys live in memory", "The key is never written to storage. Reload the page and every room locks until you re-enter its password."],
  ["Ink marks", "Four marks: acknowledged, noted, warmly received, later. They are encrypted and signed like messages."],
  ["Derived identity", "Each room gives you a different alias and signing key. Other members cannot link you across rooms."],
  ["Location stripping", "Photos are checked for EXIF metadata. If it cannot be stripped, the photo is not sent."],
  ["Installable, self-hostable", "Installs from the browser. Self-hosting needs an access token and a hostname."],
] as const;

export function WhatItIs() {
  return (
    <Section
      id="what"
      title="What it is"
      lede="CipherChat is an encrypted chat that runs in your browser. A room is a link and a password. There are no accounts. It is built for a first private conversation with someone you can verify through another channel."
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
