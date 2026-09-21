# AUDIT.md — dependency audit: policy and dispositions

CipherChat runs **two audit gates**, because a permanently red gate is
noise — red has to keep meaning "do not ship."

| Gate | Scope | Where | Behavior |
|---|---|---|---|
| **Blocking** | Runtime tree — findings from `bun audit` over **bun.lock**; runtime/dev split from a package-lock the gate materializes | `scripts/audit-gate.mjs`, called from `.github/workflows/ci.yml` | Fails CI on every critical/high runtime finding **except** the enumerated exceptions below. Fails **closed**: an error payload or missing lockfile is red, never a vacuous green |
| **Advisory** | Full tree (dev + lint + build chains) | `ci.yml` (`bun audit --audit-level=high`), `continue-on-error: true` | Review prompt only — none of it ships |

The repo locks with **bun.lock**, and the blocking gate's findings are
bound to it: `bun audit` reports advisories against the exact versions
bun installs — no re-resolution. The one approximation left is the
**runtime/dev split**, which derives from a package-lock the gate
materializes (`npm install --package-lock-only` — a fresh resolution of
the same ranges, read only for each package's `dev` flag). Versions and
advisories are lockfile-exact; only the classification rides on npm,
and a misclassification would require that resolution to drop or add a
module relative to bun's pins *and* a real advisory on it — bounded,
stated, and checked on every run.

## When the gate goes red

Escalation ladder, in order — never skip to the bottom:

1. **Fix** — semver-safe bump of the affected package.
2. **Delete** — if nothing imports it, the correct remediation for an
   unused dependency is deletion, not a major-version bump.
3. **Reclassify** — build/lint-time tooling belongs in
   `devDependencies`, which also removes it from the blocking view.
4. **Disposition + mask** — prove the bytes cannot ship, write the
   per-advisory disposition here, and only then extend `EXCEPTIONS` in
   `scripts/audit-gate.mjs` — keyed by `(module, advisory id)`, so a
   *new* advisory against an excepted module still fails the gate.

`npm audit fix --force` is **forbidden**: its idea of a fix is a
breaking downgrade (see the Prisma refusal below).

## Round 32 surgery (2026-09-18) — receipts

The runtime-tree audit was red with 9 highs. Verified-unused scaffold
dependencies were **deleted**, not upgraded:

| Removed | Evidence | Killed (runtime tree) |
|---|---|---|
| `@mdxeditor/editor` | zero imports in `src/` | (full-tree only) |
| `react-syntax-highlighter` | zero imports in `src/` | `prismjs`/`refractor` chain |
| `recharts` | only importer was orphaned scaffold `src/components/ui/chart.tsx` (deleted; no app code imports `ui/chart`) | `lodash` |
| `@reactuses/core` | zero imports in `src/` | `js-cookie`, `lodash-es` |
| `next-intl` | zero imports in `src/` | `@parcel/watcher` → `picomatch` |

Reclassified (misfiled as runtime deps):

| Package | Truth | Action |
|---|---|---|
| `prisma` (CLI) | build-time `generate`/`db push` only; `Dockerfile.web` installs full deps in the build stage and copies **only** `.next/standalone` + the Prisma engines into the runtime image | → `devDependencies` |
| `sharp` | used only by `scripts/gen-icons.ts` / `gen-splash.ts`; zero `next/image` usage in the app | → `devDependencies`, bumped 0.34.5 → **0.35.4** (the fixed release) |

Result: runtime tree **9 highs → 2** (both the prisma-CLI chain, masked
below); full tree 22 → 15 findings.

## Masked exceptions (the blocking gate's allowlist)

| Module | Advisory | Sev | Chain | Why it cannot ship |
|---|---|---|---|---|
| `deepmerge-ts` | GHSA-ggr8-5vv4-36mx | high | `@prisma/client` (graph) → `prisma` CLI → `@prisma/config` | `PrismaClient` never requires the CLI chain — verified by a `require('prisma')` scan of `node_modules/@prisma/client` (zero hits) — and the runtime image physically copies only `.next/standalone` + `node_modules/.prisma` + `node_modules/@prisma` (`deploy/Dockerfile.web`), excluding the CLI, `@prisma/config`, and everything under it. The CLI runs at build time against our own committed schema. No fixed prisma release exists (vulnerable range spans ≤ 8.1.0-dev.4). |
| `defu` | GHSA-737v-mqg7-c878 | high | `prisma` CLI → `@prisma/config` → `c12` → `defu` | Same chain, same non-shipping argument as `deepmerge-ts`. |

### The Prisma downgrade refusal, in one line

The advisory affects `@prisma/config`'s config-merge path, exercised
only by the prisma CLI during `generate`/`db push` against our own
schema; it does not ship in the runtime image, so the audit tool's
offered fix — a **downgrade** of prisma 6.19.3 → 6.12.0 — buys audit
quiet at the cost of every CLI fix since 6.12 and the client/CLI
lockstep, and is refused.

## Full-tree advisory dispositions (non-blocking)

Every remaining finding lives in the **lint / build / tooling chain**,
none of which is traced into `.next/standalone`:

| Module | Sev | Chain (verified `npm ls`, Round 32) | Disposition |
|---|---|---|---|
| `brace-expansion` | high | `typescript-eslint` → `glob`/`rimraf` → `minimatch`; `@typescript-eslint/typescript-estree` | lint-only glob engine; DoS class on patterns we author ourselves |
| `minimatch` | high | `typescript-eslint`, `eslint-plugin-import/jsx-a11y/react` | lint-only; ReDoS on our own patterns |
| `picomatch` | high | `eslint-import-resolver-typescript` → `tinyglobby`; `micromatch` | lint-only |
| `browserslist` | high | `eslint-config-next` → `eslint-plugin-react-hooks` → `@babel/core` chain | compile-target resolution at build; the untrusted-stats path requires a stats file we never supply |
| `flatted` | high | `eslint` → `file-entry-cache` → `flat-cache` | parses eslint's own cache files |
| `@babel/core` | low | `eslint-config-next` → `eslint-plugin-react-hooks` | lint-only; the sourceMappingURL file-read needs attacker-controlled build input — we lint our own source |
| `@humanfs/node` | mod | `eslint` | lint-only recursive copy |
| `baseline-browser-mapping` | mod | `browserslist` | build-only, same chain |
| `uuid` / `xcode` / `@capacitor/cli` | mod | `devDependencies` — Capacitor packaging tooling | the vulnerable buf path is never used by our icon/splash scripts |
| `deepmerge-ts`, `defu` | high | prisma CLI chain | see masked exceptions above |

## Round 35 — the gate engine switch (2026-09-21), receipts

The documentation truth audit flagged this file's fidelity claim
("what the audit sees is what bun installs") as approximate: npm
audits a **fresh re-resolution** of the ranges, not the bun.lock pins.
Probing it found something worse than an overclaim — the old gate could
fail **open**: run without a materialized lockfile, `npm audit` exits 1
with an `ENOLOCK` error object that is valid JSON with no
`vulnerabilities` key, which the old parser read as "clean tree".
CI never hit this (it materialized the lockfile in the preceding step),
but any local run without a package-lock — including this sandbox after
a machine restore wiped the untracked file — was **vacuously green**.

The switch (both directions verified):

- Findings now come from `bun audit --json` — the exact bun.lock pins.
- The runtime/dev split comes from the materialized package-lock's
  `dev` flags; a finding is adjudicated only if its module is in the
  runtime set.
- Every payload is shape-checked; a spawn failure, unparseable
  output, error object, empty runtime set, or failed materialization
  exits 1. The gate now owns its own lockfile materialization.
- Verified: real tree exit 0 with the same 2 masked exceptions
  (348 runtime modules); with `EXCEPTIONS` stripped, exit 1 naming
  exactly deepmerge-ts and defu; with either source's registry dead,
  exit 1 fail-closed. The advisory step in CI switched to
  `bun audit --audit-level=high` (native full tree, no npm).

## Keeping this file true

- Chains were verified with `npm ls <module>` (Round 32 receipts in the
  worklog) — not assumed from advisory text.
- The `require('prisma')` scan of `@prisma/client` and the
  `Dockerfile.web` runtime-stage copy list are the load-bearing evidence
  for the masked exceptions; re-verify both if either file changes.
- Any change to `EXCEPTIONS` in `scripts/audit-gate.mjs` must land in
  the same commit as its disposition row here.
- Retirement condition for the one remaining approximation: when
  `bun audit` grows dependency chains or a `--production` flag, drop the
  npm split (and the gate's materialized lockfile) entirely — findings
  and topology then both come from bun, and the last approximation
  closes.
