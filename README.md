# Luke

<!-- luke-docs:start:overview -->
Luke is the internal management platform for the wholesale fashion supply chain. It covers the full season cycle — from the collection plan to pricing, from merchandising to order-portfolio statistics — with native Microsoft Dynamics NAV integration as the reference ERP, and support for the ISO 9001:2015 quality process that governs collection revisions.

It is built as a pnpm + Turborepo monorepo with seven workspaces: a Next.js frontend, a Fastify + tRPC backend, and shared packages for schemas and RBAC, the Prisma schema and client, the NAV sync layer, the Google Calendar integration, and an internal ESLint plugin carrying Luke's own coding rules.
<!-- luke-docs:end:overview -->

## Monorepo Structure

<!-- luke-docs:start:structure -->
| Workspace | Type | Description |
|-----------|------|-------------|
| [`apps/web`](apps/web/README.md) | App | Next.js frontend — dashboard, collection, pricing, calendar, sales |
| [`apps/api`](apps/api/README.md) | App | Fastify + tRPC + Prisma backend — RBAC API, audit log, NAV integration |
| [`packages/core`](packages/core/README.md) | Package | Zod schemas, RBAC, AppConfigRegistry, storage helpers and server-only crypto |
| [`packages/db`](packages/db/README.md) | Package | Prisma schema, versioned migrations and generated client; `createPrismaClient` |
| [`packages/nav`](packages/nav/README.md) | Package | One-way Microsoft Dynamics NAV → PostgreSQL sync layer (mssql) |
| [`packages/calendar`](packages/calendar/README.md) | Package | Google Calendar integration, milestone sync engine, iCal feed generation |
| [`packages/eslint-plugin-luke`](packages/eslint-plugin-luke/README.md) | Package | Internal ESLint rules (e.g. `no-uncommented-any`, `no-uncommented-tailwind-arbitrary`) |
<!-- luke-docs:end:structure -->

## Prerequisites

<!-- luke-docs:start:prerequisites -->
- Node.js and pnpm — the supported ranges are `engines` and `packageManager` in the root `package.json`, which is the only source for them
- Docker — local PostgreSQL, the integration test database, and the S3-compatible storage container
- PostgreSQL — development and production alike; the image is pinned in the `docker-compose.*.yml` files
- An S3-compatible object store — only when `storage.type` is `s3` in AppConfig
- Microsoft SQL Server — only for the NAV sync feature
<!-- luke-docs:end:prerequisites -->

## Quick Start

<!-- luke-docs:start:quickstart -->
```bash
# Install dependencies
pnpm install

# Start the development database (PostgreSQL, 5432) and S3 storage (SeaweedFS, 8333)
docker compose -f docker-compose.dev.yml up -d

# Create apps/api/.env with at least:
#   DATABASE_URL=postgresql://luke:luke_dev@localhost:5432/luke
#   NODE_ENV=development

# Build the API and the packages it depends on (a full `pnpm build` also builds
# the web for production, which needs NEXTAUTH_SECRET)
pnpm --filter "@luke/api..." build

# Development only: reset the database, apply the migrations, seed the
# administrator and the base configuration
pnpm --filter @luke/api db:bootstrap

# Reference data: brands, seasons, company structure, catalog, holidays,
# milestone templates. db:seed reads DATABASE_URL from the shell, not apps/api/.env
DATABASE_URL=postgresql://luke:luke_dev@localhost:5432/luke pnpm db:seed

# Start every workspace in development mode
pnpm dev
```
<!-- luke-docs:end:quickstart -->

The frontend serves `http://localhost:3000` and the API `http://localhost:3001`;
the seeded administrator is `admin` / `changeme`, to change at first login.
The first process that needs it — `db:bootstrap` here, otherwise the API —
creates the master key `~/.luke/secret.key`: keep it.
Replacing it is not a supported rotation — it leaves encrypted configuration and
backups unreadable ([ADR-020](docs/decisions/020-master-key-scope-and-rotation-limits.md)).

## Available Scripts

<!-- luke-docs:start:scripts -->
| Script | Description |
|--------|-------------|
| `pnpm dev` | Starts every workspace in development mode (via Turbo) |
| `pnpm build` | Full build of every workspace |
| `pnpm lint` | Lints every TypeScript file |
| `pnpm typecheck` | Type checks every workspace |
| `pnpm db:seed` | Seeds the database (`apps/api/prisma/seed.ts`); reads `DATABASE_URL` from the shell, not from `apps/api/.env` |
| `pnpm test` | Runs every workspace's tests (via Turbo) |
| `pnpm test:integration:local` | Brings the test database up and runs the integration suite |
| `pnpm test:tools` | Tests for the control-plane scripts in `tools/scripts/` |
| `pnpm check:drift` | Runs the blocking skill, documentation, platform, tsconfig, and workflow checks; see the [drift-check contracts](tools/README.md#drift-checks). |
| `pnpm security` | SAST (semgrep) + secrets (gitleaks) + dependencies (osv-scanner) |
| `pnpm backup:open <file.lukebak> [out.tar]` | Decrypts a backup export offline into a plain tar, with no server or database; prompts for the export passphrase |
| `pnpm release:prepare <tag>` | The only release entry point: validates the tag and writes the `CHANGELOG.md` section |
| `pnpm changelog` | Prints the git-cliff output to **stdout** with no range and no version: a generic preview, **not** the notes `release:prepare` will produce |

While `pnpm dev` runs in a worktree, the scripts that rebuild a workspace `dist` (`build`, `typecheck`, `test` and their variants) refuse to start there (`scripts/assert-no-dev.sh`): stop dev, or run them from a second worktree (`git worktree add`).

Workspace-specific commands: `pnpm --filter @luke/web dev` · `pnpm --filter @luke/api dev` · `pnpm --filter @luke/core build`
<!-- luke-docs:end:scripts -->

## Deployment

<!-- luke-docs:start:deployment -->
The release flow is triggered by pushing a `vX.Y.Z` tag. A provenance gate proves the tag may publish from the line it was cut on, then GitHub Actions builds the Docker images and publishes them to `ghcr.io`; Portainer picks the new images up and redeploys the stack. Release-candidate artifacts come from the release train and publish `rc-latest`, stable artifacts come from `main` and publish `latest` plus the `X.Y` series tag. A push to a branch runs CI only: CI builds both images to check what they contain ([ADR-028](docs/decisions/028-runtime-images-carry-runtime-dependencies-only.md)) but publishes none — an image reaches `ghcr.io` only from a tag, after the same check passes on it.

The `luke_api_data` volume holds the master key (`~/.luke/secret.key`) and must never be deleted. In production, `entrypoint.sh` runs `prisma migrate deploy` before the server starts.
<!-- luke-docs:end:deployment -->

## Architecture

<!-- luke-docs:start:architecture -->
Luke is a pnpm + Turborepo monorepo with seven workspaces. The backend (`apps/api`) exposes type-safe tRPC APIs on Fastify, over PostgreSQL through Prisma, with granular `resource:action` RBAC. The frontend (`apps/web`) is a Next.js App Router application built on shadcn/ui and React, and it consumes the API's router types end to end — a contract change fails the type check instead of reaching runtime. Microsoft Dynamics NAV synchronisation lives in `packages/nav` (direct mssql, one-way NAV → Luke). Season milestones are handled by `packages/calendar`, which syncs them to Google Calendar and generates the iCal feed.

Runtime configuration is not spread across environment variables: `.env` carries infrastructural bootstrap only, and everything else lives in the `AppConfig` table behind the registry in `@luke/core`.

The versions this stack currently sits on are read from the workspace manifests, never restated here. For the key architectural decisions: [`docs/decisions/`](docs/decisions/README.md).
<!-- luke-docs:end:architecture -->

## Architectural Decisions

<!-- luke-docs:start:adr-link -->
Relevant architectural decisions are documented in [`docs/decisions/`](docs/decisions/README.md).
<!-- luke-docs:end:adr-link -->

## Where Things Live

- **Frontend** — routes, error pages, settings components, dashboard widgets:
  [`apps/web/README.md`](apps/web/README.md)
- **API** — authentication and LDAP, administrator recovery, transactional email,
  security headers, health probes, raw HTTP routes, operational scripts, storage:
  [`apps/api/README.md`](apps/api/README.md)
- **Operations** — password policy, rate limiting, idempotency, error responses,
  sign-in during an LDAP outage, email deliverability, release variables:
  [`OPERATIONS.md`](OPERATIONS.md)
- **NAV** — master-data sync, the order-portfolio and KIMO replicas, permissions:
  [`docs/nav-integration.md`](docs/nav-integration.md)
- **Engineering rules** — environment policy, AppConfig, RBAC, frontend
  conventions, import order: [`CLAUDE.md`](CLAUDE.md)
- **Decisions** — sessions
  ([ADR-019](docs/decisions/019-tokenversion-session-revocation.md)), master key
  ([ADR-020](docs/decisions/020-master-key-scope-and-rotation-limits.md)),
  runtime configuration
  ([ADR-018](docs/decisions/018-runtime-configuration-and-bootstrap-environment.md)),
  storage ([ADR-017](docs/decisions/017-key-based-storage-and-two-phase-upload.md))

## Troubleshooting

- **Wrong Node version** — `nvm use` reads `.nvmrc`.
- **Sporadic 429s, or the backend reported unreachable, in local development** —
  `NODE_ENV=development` is missing from `apps/api/.env`; see
  [Running the API locally](apps/api/README.md#running-the-api-locally).
- **`Cannot find module @luke/core/dist`** — Turbo's cache can be stale: run
  `pnpm --filter @luke/core build`.
- **Clean reinstall** — `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`.
  Keep `pnpm-lock.yaml`: it pins every dependency.

## Related Documentation

- [Documentation index](docs/README.md) — architecture, runbooks, reference material and historical evidence
- [Engineering rules](CLAUDE.md) — operational and architectural rules for repository changes
- [Agent instructions](AGENTS.md) — Codex instructions; Claude Code is governed by `CLAUDE.md`
- [Changelog](CHANGELOG.md) — release notes derived from Conventional Commits
- [Repository tooling](tools/README.md) — deterministic checks and release gates
- [Operations](OPERATIONS.md) — runtime protections and operator runbooks
- [Architecture Decision Records](docs/decisions/README.md) — canonical decision index with status and supersession links

## Release

<!-- luke-docs:start:release -->
The project uses [Conventional Commits](https://www.conventionalcommits.org/) to generate the CHANGELOG automatically through `git-cliff`. Commit messages are validated by the `.husky/commit-msg` hook (commitlint); it also rejects a `Co-Authored-By:` trailer.

Tag naming: `vX.Y.Z` (stable) or `vX.Y.Z-rc.N` (release candidate) — SemVer criteria: `patch` for a fix or refactor, `minor` for new functionality, `major` for a breaking change to a supported compatibility contract.

**The git tag is the release identity.** No manifest declares a version: there is no second number to keep aligned with the tag, and none to drift.

**`pnpm release:prepare <tag>` is the only supported entry point**: you name the version. The script refreshes the tags and `origin/main` itself and stops if it cannot, then `tools/scripts/check-release-train.ts --validate` proves the tag **before anything is written**; only afterwards does it generate the CHANGELOG section over the validated range and re-check the result with `check-release-tree.ts --worktree`. **`CHANGELOG.md` is the only file it writes.**

The validator starts from the highest stable tag **reachable from HEAD** and uses the range `base..HEAD` — a set difference on the commit graph, not a walk in date order. It refuses a tag that already exists, notes for it already committed at HEAD (a preparation committed and never tagged: tag that commit, or remove the section to prepare again), a base that is not reachable, a stable hotfix on another line that outranks that base (merge it first), a target other than the live train's frozen one, an rc counter that skips, a range with nothing releasable in it, and **any version below the minimum bump** git-cliff computes for the commits since the base, a running train's next candidate included: equal or higher passes, and there is no flag to bypass it. A train the commits have overtaken — a breaking change landing after its first candidate — can no longer graduate: its next candidate and its graduation are refused at once, its rc tags stay as history, and the next train starts at the higher version. A graduation must publish its last candidate unchanged — at preparation HEAD's tree is that candidate's tree, `CHANGELOG.md` aside, and the notes commit is then the only difference, re-proved on the tagged tree at push and in `release.yml` — so after the last candidate the train is frozen: a later change to anything but `CHANGELOG.md`, documentation included, ships by cutting another candidate first.

The checker refuses an `## [Unreleased]` heading anywhere in a release tree — what `git-cliff --unreleased` writes when run by hand. If one lands in `CHANGELOG.md`, remove only that section and keep every change already there; never restore the whole file (`checkout`/`restore`/`reset`), which would throw away the pre-existing work too.

```bash
pnpm release:prepare v3.0.0-rc.1  # First candidate (does not commit or tag)
pnpm release:prepare v3.0.0-rc.2  # Next candidate on the same train
pnpm release:prepare v3.0.0       # Promote the train to its stable version
pnpm release:prepare v3.0.1       # Hotfix on the stable line
# git-cliff with no range: generic stdout preview, not the release notes
pnpm changelog
```

`.github/workflows/release.yml` is authoritative: immediately after the provenance gate, the same job runs `tools/scripts/check-release-tree.ts` against the exact commit the gate resolved and verifies that **that tree** has exactly one `## [X.Y.Z]` section in `CHANGELOG.md` for the tag's version, with at least one `- ` entry, and — for a stable tag that graduates a train — that the tree is the highest candidate of that version unchanged, `CHANGELOG.md` aside (the job fetches the release tags explicitly). If it fails, `verify` and both image-build jobs do not start, and no image is published.

This check is deliberately narrow: it proves that the tagged tree ships notes for its own tag and, for a graduation, that it is its last candidate unchanged — not that a release was prepared. `check-release-train.ts --validate` proves the **number** during preparation; the provenance gate proves the **line**.

Push the one tag by name — `git push origin vX.Y.Z`, never `--tags`: `.husky/pre-push` refuses more than one release tag per push, and runs the same checker against the object being pushed. It is **early feedback, not enforcement** — `--no-verify` skips it, and another clone may not have it.

Notes are generated only from Conventional Commits: merge commits (`Merge pull request …`, `Merge branch …`) are excluded. A candidate whose only new commits are merges is therefore rejected by the validator during preparation — the range contains nothing releasable — before any write starts. The empty-section rejection in `check-release-tree.ts` is not what stops it; that remains a backstop for an empty section reaching the release tree by another route. This is the intended behaviour.
<!-- luke-docs:end:release -->
