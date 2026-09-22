"use client";

import { Section } from "./section";

/* How it's built: the stack in a sentence, then the practices
 * that make the claims checkable. Plain list, plain titles. */

const STACK =
  "TypeScript, React, Next.js, Tailwind CSS, Bun, Socket.IO, WebCrypto, argon2id, Prisma, Vitest, Playwright, Docker Compose.";

const PRACTICES = [
  {
    title: "Property-driven tests",
    body: "The suite is named after the properties it protects (replay, rotation, padding, KDF, identity, grace) and runs on every push.",
  },
  {
    title: "Audit-gated dependencies",
    body: "The dependency audit runs on every push. Masked advisories are listed with reasons in AUDIT.md.",
  },
  {
    title: "End-to-end tests",
    body: "Playwright drives two browsers through the full flow (create, join, talk, burn) on every push.",
  },
  {
    title: "Documentation",
    body: "DESIGN.md, COMPONENTS.md, SECURITY.md, MOBILE.md, and CHANGES.md, plus a round-by-round worklog of the build.",
  },
  {
    title: "How it fails",
    body: "When the relay is down, the app fails closed. Healthchecks are read-only and never modify what they check. Abuse reports are graded by credibility.",
  },
  {
    title: "Self-hosting",
    body: "The public deployment and self-hosted deployments run the same Docker Compose stack. Setup needs an access token and a hostname.",
  },
] as const;

export function Stack() {
  return (
    <Section
      id="stack"
      title="How it's built"
      lede="The parts are ordinary and inspectable. Every claim about them can be checked against the source."
    >
      <p className="max-w-[68ch] font-sans text-[14.5px] leading-[1.75] text-charcoal/90">
        {STACK}
      </p>

      <div className="mt-10 border-t border-hairline">
        {PRACTICES.map((p) => (
          <div
            key={p.title}
            className="grid gap-1 border-b border-hairline py-4 sm:grid-cols-[240px_1fr] sm:gap-6"
          >
            <h3 className="font-sans text-[13.5px] font-semibold">
              {p.title}
            </h3>
            <p className="max-w-[60ch] font-sans text-[13.5px] leading-[1.65] text-charcoal/85">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
