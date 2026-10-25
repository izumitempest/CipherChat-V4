"use client";

import { Section } from "./section";

/* How a room works: five steps, as a plain ordered list. Every
 * step is on the page at once, because a document is scannable. */

const STEPS = [
  {
    title: "Create",
    body: "The app generates a random link and a random password. Share them through different channels. Anyone with both can enter the room.",
  },
  {
    title: "Unlock",
    body: "The browser derives the entry key from the password with argon2id, at a cost of 64 MB of memory. The key stays in memory. It is not sent to the server and is not written to disk.",
  },
  {
    title: "Talk",
    body: "Messages, files, reactions, and ink marks are signed, padded, and encrypted before being sent. The relay forwards the frames. It cannot read them, and because all frames are the same size, it cannot tell what kind they are. Files always use the same number of frames, so a file's size stays hidden.",
  },
  {
    title: "Leave",
    body: "When a member leaves, the remaining members switch to a new random key. Each of them receives the new key individually over an ECDH connection. The new key is not derived from the password, so the departed member cannot calculate it. A member who disconnects without leaving is removed after two minutes.",
  },
  {
    title: "Burn",
    body: "Messages with timers delete themselves when the timer ends. Rooms expire on their own schedule. Any member can burn the room, which ends it for everyone immediately. There is no undo.",
  },
] as const;

export function Lifecycle() {
  return (
    <Section
      id="life"
      title="How a room works"
      lede="A room goes through five steps, always in this order."
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
