#!/usr/bin/env node
// The BLOCKING half of CipherChat's dependency audit — see AUDIT.md.
//
// What ships is the standalone runtime tree; what that tree may not carry
// is an un-dispositioned critical/high advisory. This script runs
// `npm audit --omit=dev --json` (the repo locks with bun.lock; npm is
// used only as the advisory database, exactly as ci.yml materializes it)
// and fails on every critical/high finding EXCEPT the enumerated
// exceptions below. Exceptions are keyed by (module, advisory id), so a
// NEW advisory against an excepted module still fails the gate.
//
// The full-tree audit (dev / lint / build chain) is a separate,
// NON-blocking advisory step in ci.yml: those packages never ship in the
// standalone runtime image, and each is dispositioned in AUDIT.md.

import { execFileSync } from "node:child_process";

const EXCEPTIONS = [
  {
    module: "deepmerge-ts",
    id: "GHSA-ggr8-5vv4-36mx",
    reason:
      "prisma CLI -> @prisma/config -> deepmerge-ts. PrismaClient never " +
      "requires the CLI chain (verified: zero require('prisma') under " +
      "@prisma/client) and the runtime image copies only .next/standalone " +
      "plus the Prisma engines (deploy/Dockerfile.web) — these bytes do " +
      "not ship. The CLI runs at build time against our own schema. No " +
      "fixed prisma release exists (vulnerable range spans <=8.1.0-dev.4); " +
      "the audit tool's suggested fix is a DOWNGRADE to prisma 6.12.0, " +
      "refused deliberately.",
  },
  {
    module: "defu",
    id: "GHSA-737v-mqg7-c878",
    reason:
      "prisma CLI -> @prisma/config -> c12 -> defu. Same non-shipping " +
      "chain and same refusal rationale as deepmerge-ts above.",
  },
];

const GATE = new Set(["critical", "high"]);

let audit;
try {
  audit = JSON.parse(
    execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch (err) {
  // npm audit exits non-zero when it FINDS something — the JSON is on
  // stdout either way. Only an unparseable result is a gate error.
  try {
    audit = JSON.parse(String(err.stdout ?? ""));
  } catch {
    console.error("audit-gate: npm audit could not run:", String(err.stderr ?? err.message));
    process.exit(1);
  }
}

const vulns = audit?.vulnerabilities ?? {};
const failures = [];
const masked = [];

for (const [module, v] of Object.entries(vulns)) {
  if (!GATE.has(String(v.severity ?? ""))) continue;
  // via[] mixes two shapes: objects (direct advisories on this module)
  // and strings (deeper chain nodes, which carry their own top-level
  // entries). Only the objects are adjudicated here.
  for (const a of (v.via ?? [])) {
    if (typeof a !== "object" || a === null) continue;
    const hay = `${a.url ?? ""} ${a.id ?? ""}`;
    const hit = EXCEPTIONS.find((e) => e.module === module && hay.includes(e.id));
    if (hit) {
      masked.push({ module, id: hit.id, title: a.title ?? "" });
    } else {
      failures.push({ module, id: hay.trim(), title: a.title ?? "", severity: v.severity });
    }
  }
}

if (masked.length) {
  console.log("audit-gate: masked exceptions (dispositioned in AUDIT.md):");
  for (const m of masked) console.log(`  - ${m.module} ${m.id} — ${m.title}`);
}

const seen = new Set();
const unique = failures.filter((f) => {
  const key = `${f.module}|${f.id}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

if (unique.length) {
  console.error("\naudit-gate: FAIL — runtime-tree findings outside the exception list:");
  for (const f of unique) {
    console.error(`  - ${f.module} [${f.severity}] ${f.title} (${f.id})`);
  }
  console.error(
    "\nFix, bump, or delete the dependency — or write a per-advisory disposition " +
      "in AUDIT.md and only then extend EXCEPTIONS in scripts/audit-gate.mjs.",
  );
  process.exit(1);
}

console.log(`audit-gate: runtime tree clean (${masked.length} masked, all dispositioned).`);
