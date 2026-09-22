"use client";

import { Section } from "./section";

/* Limits — the part worth reading. Every line is README prose,
 * not softened for the occasion. Two plain lists, split by a
 * rule on wide screens. */

const PROTECTS = [
  "The content of your messages and files — from the relay, the server host, and anyone without the password",
  "Room entry — argon2id stretching plus a signature-verified member registry",
  "The past — new joiners see nothing from before they joined",
  "Departed members — rotation writes them out after a bounded grace",
  "Frame metadata — uniform sizes hide file sizes and typing patterns",
] as const;

const DOES_NOT = [
  "Metadata — the relay sees who talks to whom, when, and how much",
  "View-once — a promise, not enforcement; a member can keep what they decrypt (Signal has the same limit)",
  "Insiders — a member can publish the key or push nuisance rotations; group E2EE polices outsiders, not participants",
  "The password — it cannot be changed for the room's lifetime; knowledge is permanent",
  "Your device — malware, XSS or physical access reads everything",
  "Nation-states — if that's your opponent, use Signal or SimpleX",
] as const;

export function Limits() {
  return (
    <Section
      id="limits"
      title="What it doesn't protect against"
      lede="Read this part. Every limit is documented with the same care as the features, because a claim you can't check is a claim you shouldn't trust."
    >
      <div className="grid gap-10 md:grid-cols-2 md:gap-0">
        <div className="md:pr-10">
          <h3 className="border-b border-hairline pb-2.5 font-sans text-[12.5px] font-medium text-forest">
            It protects
          </h3>
          <ul>
            {PROTECTS.map((line) => (
              <li
                key={line}
                className="flex gap-3.5 border-b border-hairline py-3"
              >
                <span
                  aria-hidden
                  className="mt-px shrink-0 font-sans text-[13px] leading-[1.6] text-forest"
                >
                  +
                </span>
                <span className="font-sans text-[13.5px] leading-[1.65] text-charcoal/90">
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:border-l md:border-hairline md:pl-10">
          <h3 className="border-b border-hairline pb-2.5 font-sans text-[12.5px] font-medium text-terracotta">
            It does not
          </h3>
          <ul>
            {DOES_NOT.map((line) => (
              <li
                key={line}
                className="flex gap-3.5 border-b border-hairline py-3"
              >
                <span
                  aria-hidden
                  className="mt-px shrink-0 font-sans text-[13px] leading-[1.6] text-terracotta"
                >
                  −
                </span>
                <span className="font-sans text-[13.5px] leading-[1.65] text-charcoal/85">
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
