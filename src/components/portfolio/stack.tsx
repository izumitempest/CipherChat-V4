"use client";

import { Section } from "./section";

/* How it's built — the stack in a sentence, then the practices
 * that make the claims checkable. Plain list, plain titles. */

const STACK =
  "TypeScript, React, Next.js, Tailwind CSS, Bun, Socket.IO, WebCrypto, argon2id, Prisma, Vitest, Playwright, Docker Compose.";

const PRACTICES = [
  {
    title: "Property-driven tests",
    body: "The suite is named after the properties it protects — replay, rotation, padding, KDF, identity, grace — and runs as part of the standing gates.",
  },
  {
    title: "Audit-gated dependencies",
    body: "Installs re-verify against the lockfile; masked advisories are recorded in AUDIT.md, not hidden.",
  },
  {
    title: "End-to-end tests",
    body: "Playwright drives two real browsers through create → join → talk → burn, end to end, on every push.",
  },
  {
    title: "Documentation",
    body: "DESIGN.md, COMPONENTS.md, SECURITY.md, MOBILE.md, CHANGES.md — and a round-by-round worklog of the whole build.",
  },
  {
    title: "How it fails",
    body: "Fail-closed degradation when the relay is down; read-only healthchecks that never mutate what they probe; graded abuse reporting.",
  },
  {
    title: "Self-hosting",
    body: "One token, one hostname, then docker compose up — your server, the same code the public deployment runs.",
  },
] as const;

export function Stack() {
  return (
    <Section
      id="stack"
      title="How it's built"
      lede="Ordinary, inspectable parts — assembled so every claim about them can be checked against the bytes."
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
