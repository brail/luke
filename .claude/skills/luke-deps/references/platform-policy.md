# Platform policy — approved technologies and where their facts live

Companion to `.claude/skills/luke-deps/SKILL.md`, used by `platform` and
`evaluate` mode. Ownership boundaries are in
`.claude/skills/luke-shared/governance-map.md`.

## The one rule of this file

**It records where a platform fact lives, never what the fact currently is.**

No installed or resolved version is written here — no dependency version, no
pin, no image tag, no `engines` range. A copied current version is a second
source of truth, and a second source of truth drifts: that is the defect this
file exists to prevent, not one to reproduce in a new location. Every current
version is read at run time from the authority column below.

If you find yourself wanting to write today's number here, the answer is a
command that reads it.

**The exception is a version that is itself the subject of a decision.** A
migration target, a hold, an unblock condition or a deprecation deadline names a
version because the version *is* the policy, not an observation about the tree —
"held until TypeScript 7.1 stable" cannot be derived from any manifest, and it
does not drift when the repository upgrades. Those live in §4 and nowhere else.
The test is direction: if a manifest could contradict the number, it does not
belong here; if the number is what a manifest will one day be *held against*, it
does.

---

## 1. Authority table

| Platform fact             | Live authority                                                                 | Governance rule                                                       |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Workspace membership      | `pnpm-workspace.yaml` + each workspace `package.json`                          | no workspace root outside the declared globs                          |
| pnpm exact tool           | root `package.json` `packageManager`                                           | changed with Corepack only; never hand-edit the integrity hash        |
| Node compatibility range  | root `package.json` `engines.node`                                             | track the Active LTS lifecycle, not the newest number                 |
| Node execution pins       | `.nvmrc`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.github/actions/setup-workspace/action.yml` | every pin site on the same approved major     |
| Dependency versions       | workspace manifests + `pnpm-lock.yaml`                                         | one version per external package across the workspace                 |
| Dependency families       | the same manifests                                                             | families move in lockstep; see the family rule in the matrix          |
| Supply chain              | `pnpm-workspace.yaml` (`overrides`, `allowBuilds`, release age), `.github/dependabot.yml` | no inert or expired policy; every override commented with its GHSA id |
| Build graph               | `turbo.json`                                                                   | a task edge must reflect a real artifact dependency                   |
| TypeScript configuration  | root `tsconfig.json` + per-workspace `tsconfig*.json`                          | runtime boundaries explicit; test corpora reachable by a typecheck    |
| Lint                      | `eslint.config.mjs` + `packages/eslint-plugin-luke/`                           | official framework rules and project rules both actually active       |
| ORM                       | `packages/db/prisma/*.prisma`, `packages/db/prisma.config.ts`, the Prisma package family | supported generator; schema and migrations in agreement       |
| Database runtime          | `docker-compose.test.yml`, CI service images, `apps/api/Dockerfile`            | client and server majors pinned together                              |
| Test toolchain            | `apps/api/vitest.config.mts`, `apps/api/vitest.integration.config.mts`, `apps/web/vitest.config.mts`, `apps/web/vitest.browser.config.mts`, `apps/web/playwright.config.ts` | every tier reachable from a named root script; the browser tier keeps its own project so the fast path provisions no browser |
| CI                        | `.github/workflows/`, `.github/actions/setup-workspace/action.yml`             | gates fail closed; the shared setup action is authoritative           |
| Security gates            | root `package.json` security scripts, `.semgrep/rules/`, `.husky/`             | the three gates stay consistent; a chain fails closed                 |
| Agent runtime             | `.claude/`                                                                     | execution semantics explicit, never an implicit runtime default       |

## 2. Approved technologies

Named, not versioned. A change to this list is an architectural decision and
goes through `evaluate`, not through a dependency bump.

```
package manager   pnpm            (never npm, never yarn)
monorepo runner   Turborepo
runtime           Node LTS
web               Next.js + React + Tailwind + shadcn/ui
api               Fastify + tRPC
ORM               Prisma on PostgreSQL
validation        Zod, owned by @luke/core
integration       mssql for NAV, isolated in @luke/nav
tests             Vitest (unit, integration) + Playwright (E2E)
lint              ESLint flat config + eslint-plugin-luke
static analysis   Semgrep, Gitleaks, OSV
```

## 3. Lifecycle policy

- **Node** — follow Active LTS. A move happens when the current major leaves
  Active, not when a newer one appears. Every pin site in the authority table
  moves in the same cycle.
- **pnpm** — `corepack use pnpm@<version>` writes `packageManager` with the
  correct integrity hash. Keep `engines.pnpm` consistent with what CI and the
  Dockerfiles actually run.
- **Overrides** — debt with an expiry. Range, capped where an uncapped range
  would drag transitive consumers onto a new major, commented with the GHSA id.
  Reviewed on every run: an override whose upstream has published a clean
  version in the natural range is dead weight.
- **Release age** — quarantine is either on or off. An exclusion list without a
  `minimumReleaseAge` is inert policy that reads as protection. This is a
  decision to surface, never one to make silently.
- **Majors** — one per verification cycle, always.

## 4. Held technology decisions

A hold is a deliverable: without a recorded reason and unblock condition it gets
re-litigated from scratch next quarter. Held items are recorded by `evaluate`
and reviewed when their unblock condition changes.

| Decision            | State | Unblocks when                                                                                                                  |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 7        | HOLD  | 7.1 stable, and `typescript-eslint`, `ts-morph`, Next tooling, Prisma-generated types, Vite/Vitest and declaration builds all pass a compatibility gate. No TS6/TS7 bridge in the meantime |
| Prisma next major   | HOLD  | the generator migration on the current major is complete and production-stable; never bundled with it                          |

## 5. What `platform` mode may not do

- run a registry freshness query for every package — that is `review` mode;
- install, update, or edit a manifest — `platform` is read-only;
- decide a policy the repository has not decided, release age included;
- copy a version out of a manifest into any skill or reference file.
