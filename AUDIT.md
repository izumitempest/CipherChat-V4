# AUDIT.md — dependency audit: policy and dispositions

CipherChat runs **two audit gates**, because a permanently red gate is
noise — red has to keep meaning "do not ship."

| Gate | Scope | Where | Behavior |
|---|---|---|---|
| **Blocking** | Runtime tree (`npm audit --omit=dev`) | `scripts/audit-gate.mjs`, called from `.github/workflows/ci.yml` | Fails CI on every critical/high finding **except** the enumerated exceptions below |
| **Advisory** | Full tree (dev + lint + build chains) | `ci.yml`, `continue-on-error: true` | Review prompt only — none of it ships |

The repo locks with **bun.lock**. The npm lockfile is materialized fresh
by CI on every run (`npm install --package-lock-only`) purely so
`npm audit` has an advisory database; it is never committed. Both views
derive from `package.json`, so what the audit sees is what bun installs.

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

## Round 32 surgery (2026-…) — receipts

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

## Keeping this file true

- Chains were verified with `npm ls <module>` (Round 32 receipts in the
  worklog) — not assumed from advisory text.
- The `require('prisma')` scan of `@prisma/client` and the
  `Dockerfile.web` runtime-stage copy list are the load-bearing evidence
  for the masked exceptions; re-verify both if either file changes.
- Any change to `EXCEPTIONS` in `scripts/audit-gate.mjs` must land in
  the same commit as its disposition row here.
