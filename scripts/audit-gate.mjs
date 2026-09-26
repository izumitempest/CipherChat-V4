#!/usr/bin/env node
// The BLOCKING half of CipherChat's dependency audit, see AUDIT.md.
//
// What ships is the standalone runtime tree; what that tree may not carry
// is an un-dispositioned critical/high advisory.
//
// Two sources, one verdict (since the Round 35 engine switch):
//
//   1. FINDINGS come from `bun audit --json`, bound to the EXACT
//      versions pinned in bun.lock, the lockfile the project actually
//      installs from. (The previous engine audited npm's fresh
//      re-resolution of the same ranges, which can drift from the pins,
//      and, run without a materialized lockfile, failed VACUOUSLY
//      green: npm's ENOLOCK error object is valid JSON with no
//      `vulnerabilities` key, which the old parser read as "clean".
//      That fail-open hole is why the payloads below are shape-checked.)
//
//   2. The RUNTIME/DEV SPLIT comes from npm's materialized lockfile
//      (`npm install --package-lock-only`, owned by this script): a
//      package marked `"dev": true` there is reachable only through
//      devDependencies and never ships. The split is the one remaining
//      approximation (npm re-resolves ranges to derive it) and is
//      stated as such in AUDIT.md. Versions and advisories are
//      lockfile-exact; only the classification rides on npm.
//
// The gate fails CLOSED: an unparseable payload, a missing lockfile, a
// failed materialization, or an error object where findings were
// expected is a gate FAILURE, never a clean pass. A gate that audits
// nothing is red.
//
// Failures on critical/high runtime findings exit 1 EXCEPT for the
// enumerated exceptions below, keyed by (module, advisory id), so a NEW
// advisory against an excepted module still fails the gate.
//
// The full-tree audit (dev / lint / build chain) is a separate,
// NON-blocking advisory step in ci.yml (`bun audit --audit-level=high`,
// continue-on-error): those packages never ship in the standalone
// runtime image, and each is dispositioned in AUDIT.md.

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

function die(msg) {
  console.error(`audit-gate: FAIL (fail-closed) — ${msg}`);
  process.exit(1);
}

// Run a command, tolerating the non-zero exits both tools use to signal
// FINDINGS (not errors). stdout is returned either way; a spawn failure
// is fatal.
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = String(err.stdout ?? "");
    if (!out && !err.stderr) die(`${cmd} could not run: ${err.message}`);
    return out; // non-zero exit WITH output = findings, parse them
  }
}

// ---- 1. Findings: bun audit over the real lockfile ------------------

const rawAudit = run("bun", ["audit", "--json"]);
let audit;
try {
  audit = JSON.parse(rawAudit);
} catch {
  die("bun audit --json did not produce parseable output.");
}
// Shape check: a plain object of module -> advisory[]. Anything else,
// including an {error: …} payload, is a gate failure, never "clean".
if (
  typeof audit !== "object" ||
  audit === null ||
  Array.isArray(audit) ||
  Object.values(audit).some((v) => !Array.isArray(v))
) {
  die(
    "bun audit payload has an unexpected shape (error object? registry trouble?). " +
      "Refusing to pass a gate that may have audited nothing.",
  );
}

// ---- 2. Scope: the runtime/dev split from npm's materialized lockfile

run("npm", [
  "install",
  "--package-lock-only",
  "--ignore-scripts",
  "--no-audit",
  "--silent",
]);
let lock;
try {
  lock = JSON.parse(execFileSync("cat", ["package-lock.json"], { encoding: "utf8" }));
} catch {
  die("package-lock.json could not be read after materialization.");
}
const packages = lock?.packages;
if (typeof packages !== "object" || packages === null) {
  die("materialized package-lock.json has no packages map.");
}
const runtimeModules = new Set();
for (const [path, p] of Object.entries(packages)) {
  if (!path.startsWith("node_modules/")) continue;
  if (p?.dev) continue; // reachable only via devDependencies, never ships
  const name = path.slice("node_modules/".length).split("/node_modules/").pop();
  runtimeModules.add(name);
}
if (runtimeModules.size === 0) {
  die("runtime module set is empty — the scope source is broken, not the tree clean.");
}

// ---- 3. Adjudicate ----------------------------------------------------

const failures = [];
const masked = [];
const seen = new Set();

for (const [module, advisories] of Object.entries(audit)) {
  for (const a of advisories) {
    const severity = String(a?.severity ?? "");
    if (!GATE.has(severity)) continue;
    if (!runtimeModules.has(module)) continue; // dev chain, the advisory gate's turf
    const ghsa = (String(a?.url ?? "").match(/GHSA-[a-z0-9-]+/) ?? [])[0] ?? String(a?.id ?? "?");
    const key = `${module}|${ghsa}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = EXCEPTIONS.find((e) => e.module === module && ghsa === e.id);
    if (hit) {
      masked.push({ module, id: hit.id, title: String(a?.title ?? "") });
    } else {
      failures.push({ module, id: ghsa, title: String(a?.title ?? ""), severity });
    }
  }
}

if (masked.length) {
  console.log("audit-gate: masked exceptions (dispositioned in AUDIT.md):");
  for (const m of masked) console.log(`  - ${m.module} ${m.id} — ${m.title}`);
}

if (failures.length) {
  console.error("\naudit-gate: FAIL — runtime-tree findings outside the exception list:");
  for (const f of failures) {
    console.error(`  - ${f.module} [${f.severity}] ${f.title} (${f.id})`);
  }
  console.error(
    "\nFix, bump, or delete the dependency — or write a per-advisory disposition " +
      "in AUDIT.md and only then extend EXCEPTIONS in scripts/audit-gate.mjs.",
  );
  process.exit(1);
}

console.log(
  `audit-gate: runtime tree clean (${masked.length} masked, all dispositioned; ` +
    `${runtimeModules.size} runtime modules, findings bound to bun.lock pins).`,
);
