# Repository Tooling

`tools/` contains repository-wide deterministic checks, their tests, one
codemod, and historical reports. Application runtime code does not depend on
this directory.

## Drift checks

Run the complete deterministic drift suite from the repository root:

```bash
pnpm check:drift
```

The command runs these six checks in order and stops on the first failure:

| Checker | Contract |
|---------|----------|
| [`check-skill-integrity.ts`](scripts/check-skill-integrity.ts) | Verifies paths, symbols, execution contracts, and argument binding referenced by Claude skills. |
| [`check-docs-integrity.ts`](scripts/check-docs-integrity.ts) | Verifies tracked Markdown markers, relative links and heading fragments, reachability from the repository README, the owned docs index surface, and ADR index completeness and exact titles. |
| [`check-platform-integrity.ts`](scripts/check-platform-integrity.ts) | Verifies workspace, dependency, runtime, and security-tooling invariants. |
| [`check-tsconfig-integrity.ts`](scripts/check-tsconfig-integrity.ts) | Verifies the TypeScript configuration graph and runtime boundaries. |
| [`check-workflow-branches.ts`](scripts/check-workflow-branches.ts) | Verifies that CI, security, and release workflows agree on the active release train. |
| [`check-workflow-paths.ts`](scripts/check-workflow-paths.ts) | Verifies documentation routing, workflow path filters, and aggregate-gate structure. |

The documentation and skill checkers derive their corpora from git rather than
from hand-maintained file inventories. Their shared git-path and reporting
behavior lives in [`scripts/lib/`](scripts/lib/).

Fragment validation covers inline Markdown links to headings in the tracked
corpus, including same-file links and directory README indexes. Fenced examples
and HTML comments are excluded. Reference-style links, HTML headings and
block-container headings are not parsed. Targets containing custom HTML anchors
are skipped as a documented parser limitation, not a per-file ignore mechanism.
Frozen historical documents remain subject to structural checks.

## Release gates

These scripts implement release contracts used by the preparation script,
GitHub Actions, or the pre-push hook:

| Checker | Contract |
|---------|----------|
| [`check-release-train.ts`](scripts/check-release-train.ts) | Validates an explicitly named release target against the reachable stable line and the open RC train. |
| [`check-release-provenance.ts`](scripts/check-release-provenance.ts) | Validates the tagged commit's git line and derives the registry tags it may publish. |
| [`check-release-tree.ts`](scripts/check-release-tree.ts) | Verifies that the exact tagged tree contains release notes for its tag. |

Use `pnpm release:prepare <tag>` for release preparation rather than invoking
these implementation scripts as a substitute for the supported workflow.

## Verification

The checker suites use throwaway git fixtures and live next to their
implementations as `*.test.ts` files.
Two suites cover contracts implemented outside this directory:
`check-app-version-contract.test.ts` pins the `apps/web` build-version wiring,
and `check-release-stable-line.test.ts` covers `scripts/release-prepare.sh`.

```bash
pnpm lint:tools
pnpm typecheck:tools
pnpm test:tools
```

## Codemod

[`codemods/eliminate-hardcoded-urls.ts`](codemods/eliminate-hardcoded-urls.ts)
finds frontend API URLs that bypass the shared URL builders. Preview changes
before applying them:

```bash
pnpm codemod:check-urls
pnpm codemod:eliminate-urls
```

## Historical reports

These reports preserve the evidence from earlier one-time cleanup work. They
are historical records, not instructions to rerun removed scripts:

- [Import optimization report](reports/import-optimization-final-report.md)
- [Unused-files analysis](reports/unused-files.report.md)
