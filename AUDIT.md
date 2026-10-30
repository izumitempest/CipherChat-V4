# AUDIT.md, dependency audit

Two gates, because a gate that is permanently red is noise. Red has to
keep meaning do not ship.

| Gate | Scope | Where | Behavior |
|---|---|---|---|
| Blocking | Runtime tree. Findings from `bun audit` over `bun.lock`. Runtime vs dev split comes from the same `bun.lock`, walked from the root workspace's production dependencies. | `scripts/audit-gate.mjs`, called from `.github/workflows/ci.yml` | Fails CI on every critical or high runtime finding except the exceptions listed below. Fails closed: an error payload or a missing lockfile is red, never a vacuous green. |
| Advisory | Full tree, dev plus lint plus build chains. | `ci.yml`, `bun audit --audit-level=high`, `continue-on-error: true` | Review prompt only. None of it ships. |

The repo locks with `bun.lock` and the blocking gate reads nothing
else. `bun audit` reports advisories against the exact versions bun
installs, no re-resolution, and the runtime/dev split comes from
walking that same lockfile: the gate starts at the root workspace's
production dependencies and follows the dependency edges, so the scope
is exactly what can ship. Versions, advisories and scope all come from
one file, read with one tool, with no network in the loop.

The split used to come from a package-lock the gate materialized
itself, `npm install --package-lock-only`, a fresh resolution of the
same ranges read only for each package's `dev` flag. That was the last
approximation in the gate: two lockfiles, two package managers, and a
resolver that was not the one installing the project. See Round 36
below.

## When the gate goes red

Escalation ladder, in order. Never skip to the bottom.

1. Fix. A semver-safe bump of the affected package.
2. Delete. If nothing imports it, deleting it is the remediation, not a
   major version bump.
3. Reclassify. Build and lint time tooling belongs in
   `devDependencies`, which also takes it out of the blocking view.
4. Disposition and mask. Prove the bytes cannot ship, write the
   disposition here, and only then extend `EXCEPTIONS` in
   `scripts/audit-gate.mjs`, keyed by `(module, advisory id)`, so a new
   advisory against an already excepted module still fails the gate.

`npm audit fix --force` is forbidden. Its idea of a fix is a breaking
downgrade, see the prisma refusal below.

## Round 32 surgery, 2026-09-18

The runtime tree was red with 9 highs. The unused scaffold
dependencies were deleted, not upgraded.

| Removed | Evidence | Killed in the runtime tree |
|---|---|---|
| `@mdxeditor/editor` | zero imports in `src/` | full tree only |
| `react-syntax-highlighter` | zero imports in `src/` | the `prismjs` and `refractor` chain |
| `recharts` | the only importer was orphaned scaffold `src/components/ui/chart.tsx`, deleted, no app code imports `ui/chart` | `lodash` |
| `@reactuses/core` | zero imports in `src/` | `js-cookie`, `lodash-es` |
| `next-intl` | zero imports in `src/` | `@parcel/watcher` then `picomatch` |

Reclassified, filed as runtime deps when they are not:

| Package | Truth | Action |
|---|---|---|
| `prisma` (CLI) | build time `generate` and `db push` only. `Dockerfile.web` installs full deps in the build stage and copies only `.next/standalone` plus the prisma engines into the runtime image. | moved to `devDependencies` |
| `sharp` | only `scripts/gen-icons.ts` and `gen-splash.ts` use it, zero `next/image` usage in the app. | moved to `devDependencies`, bumped 0.34.5 to 0.35.4, the fixed release |

Result: runtime tree 9 highs down to 2, both the prisma CLI chain,
masked below. Full tree 22 down to 15 findings.

## Masked exceptions, the blocking gate's allowlist

| Module | Advisory | Sev | Chain | Why it cannot ship |
|---|---|---|---|---|
| `deepmerge-ts` | GHSA-ggr8-5vv4-36mx | high | `@prisma/client` (graph) then prisma CLI then `@prisma/config` | `PrismaClient` never requires the CLI chain. Verified with a `require('prisma')` scan of `node_modules/@prisma/client`, zero hits. The runtime image copies only `.next/standalone`, `node_modules/.prisma` and `node_modules/@prisma`, excluding the CLI, `@prisma/config` and everything under it. The CLI runs at build time against our own committed schema. No fixed prisma release exists, the vulnerable range spans to 8.1.0-dev.4. |
| `defu` | GHSA-737v-mqg7-c878 | high | prisma CLI then `@prisma/config` then `c12` then `defu` | Same chain, same non-shipping argument. |

### The prisma downgrade refusal

The advisory hits `@prisma/config`'s config-merge path, which only the
prisma CLI exercises during `generate` and `db push` against our own
schema. It does not ship in the runtime image. So the audit tool's
offered fix, a downgrade of prisma 6.19.3 to 6.12.0, buys audit quiet
at the cost of every CLI fix since 6.12 and the client/CLI lockstep.
Refused.

## Full tree dispositions, non blocking

Every finding left lives in the lint, build or tooling chain, none of
which is traced into `.next/standalone`.

| Module | Sev | Chain, verified with `npm ls`, round 32 | Disposition |
|---|---|---|---|
| `brace-expansion` | high | `typescript-eslint` then `glob` and `rimraf` then `minimatch`, and `@typescript-eslint/typescript-estree` | lint only glob engine. DoS class on patterns we write ourselves. |
| `minimatch` | high | `typescript-eslint`, `eslint-plugin-import/jsx-a11y/react` | lint only. ReDoS on our own patterns. |
| `picomatch` | high | `eslint-import-resolver-typescript` then `tinyglobby`, and `micromatch` | lint only |
| `browserslist` | high | `eslint-config-next` then `eslint-plugin-react-hooks` then the `@babel/core` chain | compile target resolution at build. The untrusted stats path needs a stats file we never supply. |
| `flatted` | high | `eslint` then `file-entry-cache` then `flat-cache` | parses eslint's own cache files |
| `@babel/core` | low | `eslint-config-next` then `eslint-plugin-react-hooks` | lint only. The sourceMappingURL file read needs attacker controlled build input, and we lint our own source. |
| `@humanfs/node` | mod | `eslint` | lint only recursive copy |
| `baseline-browser-mapping` | mod | `browserslist` | build only, same chain |
| `uuid`, `xcode`, `@capacitor/cli` | mod | `devDependencies`, capacitor packaging tooling | the vulnerable buf path is never used by our icon and splash scripts |
| `deepmerge-ts`, `defu` | high | prisma CLI chain | see masked exceptions |

## Round 35, the gate engine switch, 2026-09-21

The documentation truth audit flagged this file's fidelity claim, what
the audit sees is what bun installs, as approximate. npm audits a fresh
re-resolution of the ranges, not the bun.lock pins. Probing it found
something worse than an overclaim. The old gate could fail open: run
without a materialized lockfile, `npm audit` exits 1 with an `ENOLOCK`
error object that is valid JSON with no `vulnerabilities` key, and the
old parser read that as a clean tree. CI never hit it, it materialized
the lockfile in the step before, but any local run without a
package-lock, including this sandbox after a machine restore wiped the
untracked file, was vacuously green.

The switch, verified both directions:

- Findings come from `bun audit --json` now, the exact bun.lock pins.
- The runtime/dev split comes from the materialized package-lock's
  `dev` flags, and a finding is only adjudicated if its module is in
  the runtime set.
- Every payload is shape checked. A spawn failure, unparseable output,
  error object, empty runtime set, or failed materialization exits 1.
  The gate owns its own lockfile materialization.
- Verified: real tree exits 0 with the same 2 masked exceptions, 348
  runtime modules. With `EXCEPTIONS` stripped, exit 1 naming exactly
  deepmerge-ts and defu. With either source's registry dead, exit 1,
  fail closed. The advisory step in CI switched to
  `bun audit --audit-level=high`, native full tree, no npm.

## Round 36, one lockfile, 2026-10-29

The gate carried two lockfiles: `bun.lock` for the pins and findings, a
materialized npm lockfile for the runtime/dev split. The npm half was
the fragile part: it needed the network to build, it resolved the
ranges again (so it could disagree with bun's pins), and a machine
without the materialized file had a gate that failed for the wrong
reason.

The split now comes from `bun.lock` itself. The gate reads the
lockfile, starts at the root workspace's production dependencies and
follows the dependency edges through the packages map. What it reaches
is what can ship. `bun.lock` is JSON with trailing commas, so the gate
has a small tolerant reader for it.

- Verified: the real tree exits 0 with the same masked exception
  (deepmerge-ts) and 400 runtime modules.
- With `EXCEPTIONS` stripped it exits 1, naming exactly the modules
  the exception list covers.
- The gate no longer shells out to npm, so it no longer needs the
  network, and there is no second lockfile to materialize or ignore.
- The `package-lock.json` ignore in `.gitignore` stays: npm's file is
  not the project's lockfile and must not be committed.

## Keeping this file true

- Chains were verified with `npm ls <module>`, not assumed from the
  advisory text. Round 32 receipts are in the worklog.
- The `require('prisma')` scan of `@prisma/client` and the
  `Dockerfile.web` runtime stage copy list are the load bearing
  evidence for the masked exceptions. Re-verify both if either file
  changes.
- Any change to `EXCEPTIONS` in `scripts/audit-gate.mjs` lands in the
  same commit as its disposition row here.
- The runtime/dev split is a walk over `bun.lock`. If the lockfile
  format changes, the walk changes with it: check the runtime module
  count in the gate's output line and compare it with the last run.

One thing this file does not cover yet: nothing. The runtime and dev
split rode on two package managers, `bun.lock` for the pins and a
materialized npm lockfile for the classification. That is closed, see
Round 36. Tracked as bugs/BUGS.md B43.
