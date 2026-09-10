# luke-docs — README templates (`readme` mode)

Every generated section lives between `<!-- luke-docs:start:NAME -->` /
`<!-- luke-docs:end:NAME -->` markers. Content outside the markers = manual,
never touch it.

## Update logic (subsequent runs)

**Every row below applies to the README files templated in this file, and to no
other.** A `luke-docs` marker is not a claim of ownership: `docs/decisions/README.md`
carries one and belongs to `adr` mode. The ownership table in `SKILL.md` decides,
and it is the only place that does.

| Situation                              | Behavior                                       |
| ----------------------------------------- | ------------------------------------------------- |
| README doesn't exist                      | Write everything from scratch with all markers    |
| README exists, section has markers        | Replace the content between the markers           |
| README exists, section has no markers     | **Don't touch it** — it was written manually      |
| Marker present but content empty          | Generate the content                              |

---

## `/README.md` (root)

```markdown
# Luke

<!-- luke-docs:start:overview -->

{1-2 paragraphs: what Luke is, who uses it, what problem it solves — FEBOS/BLAUER,
internal B2B, collection management, season planning, sourcing, merchandise planning.
Mention ISO 9001 and NAV integration if relevant.}

<!-- luke-docs:end:overview -->

## Monorepo Structure

<!-- luke-docs:start:structure -->

{Table: Workspace | Type | Description — generate from the Phase 1 dictionary}

<!-- luke-docs:end:structure -->

## Prerequisites

<!-- luke-docs:start:prerequisites -->

{Required runtimes: Node.js, pnpm, Docker, PostgreSQL, S3-compatible storage,
MSSQL for NAV sync. Name them without versions; manifests and runtime
configuration are the live sources.}

<!-- luke-docs:end:prerequisites -->

## Quick Start

<!-- luke-docs:start:quickstart -->

{Bash block: clone, pnpm install, cp .env.example .env, pnpm dev}

<!-- luke-docs:end:quickstart -->

## Available Scripts

<!-- luke-docs:start:scripts -->

{Table of relevant root-level scripts: dev, build, lint, typecheck, test, db:migrate}

<!-- luke-docs:end:scripts -->

## Deployment

<!-- luke-docs:start:deployment -->

{3-4 sentences: conventional tag → GitHub Actions → ghcr.io → Portainer.
Don't invent details you can't verify from the codebase.}

<!-- luke-docs:end:deployment -->

## Architecture

<!-- luke-docs:start:architecture -->

{Short paragraph: stack, main patterns (end-to-end tRPC types, RBAC, NAV sync).
Link to docs/decisions/ for architectural decisions.}

<!-- luke-docs:end:architecture -->

## Architectural Decisions

<!-- luke-docs:start:adr-link -->

Relevant architectural decisions are documented in [`docs/decisions/`](docs/decisions/README.md).

<!-- luke-docs:end:adr-link -->

## Release

<!-- luke-docs:start:release -->

{Conventional commits + git-cliff for automatic CHANGELOG.
Tag naming: vX.Y.Z. commitlint + husky hooks active.}

<!-- luke-docs:end:release -->
```

---

## `apps/web/README.md`

```markdown
# apps/web — Luke Frontend

<!-- luke-docs:start:overview -->

{Framework and UI layer, named but never versioned — read the versions from apps/web/package.json and the routing style from the app directory. What it renders, who uses it.}

<!-- luke-docs:end:overview -->

## Main Routes

<!-- luke-docs:start:routes -->

{2-level directory tree of `src/app/` with one descriptive line for each.
Use markdown indentation, not a table.}

<!-- luke-docs:end:routes -->

## Internal Dependencies

<!-- luke-docs:start:internal-deps -->

{List of internal packages/ imported by this app.}

<!-- luke-docs:end:internal-deps -->

## Environment Variables

<!-- luke-docs:start:env -->

{Table: Variable | Description | Required. Only the ones consumed by web.}

<!-- luke-docs:end:env -->

## Local Development

<!-- luke-docs:start:dev -->

{Command to start dev from the monorepo root and from the app's directory.}

<!-- luke-docs:end:dev -->
```

---

## `apps/api/README.md`

```markdown
# apps/api — Luke Backend

<!-- luke-docs:start:overview -->

{Server stack, named but never versioned — read the versions from apps/api/package.json. What it exposes (tRPC endpoint, any REST).}

<!-- luke-docs:end:overview -->

## tRPC Routers

<!-- luke-docs:start:trpc-routers -->

{List of router namespaces (from the file listing in `src/routers/`).
Format: `namespace.*` — short description}

<!-- luke-docs:end:trpc-routers -->

## Internal Packages

<!-- luke-docs:start:internal-deps -->

{List of imported packages/.}

<!-- luke-docs:end:internal-deps -->

## Environment Variables

<!-- luke-docs:start:env -->

{Table: Variable | Type | Default | Description.
Sources: `.env.production.example` + env policy in CLAUDE.md.
Mention `assertEnvPolicy()` in `apps/api/src/server.ts` (production enforcement).}

<!-- luke-docs:end:env -->

## Database

<!-- luke-docs:start:database -->

{PostgreSQL + Prisma. migrate + studio commands. List of models detected in Phase 1.}

<!-- luke-docs:end:database -->

## NAV Sync

<!-- luke-docs:start:nav -->

{packages/nav, direct MSSQL (no DAB), one-way NAV → Luke sync.
NAV config read from AppConfig, not from env.}

<!-- luke-docs:end:nav -->

## Storage

<!-- luke-docs:start:storage -->

{IStorageProvider provider. Valid buckets: read `isValidBucket()` in
`packages/core/src/storage/config.ts` — don't hardcode the list.
Content-addressed SHA256 key for revision photos.}

<!-- luke-docs:end:storage -->
```

---

## `packages/*/README.md` (one per package)

```markdown
# @luke/{name}

<!-- luke-docs:start:overview -->

{1 sentence: what this package does, what domain problem it solves.}

<!-- luke-docs:end:overview -->

## Used By

<!-- luke-docs:start:dependents -->

{List of apps/packages that import from this package — from the Phase 1 dictionary.}

<!-- luke-docs:end:dependents -->

## Main Exports

<!-- luke-docs:start:exports -->

{Table or list: Symbol | Type | Short description.
Only public exports from `src/index.ts`. Max 20 rows — if there are too many exports, group by category.}

<!-- luke-docs:end:exports -->

## Key Concepts

<!-- luke-docs:start:concepts -->

{3-6 bullet points on non-obvious behaviors, patterns, architectural constraints of the package.}

<!-- luke-docs:end:concepts -->

## Usage Example

<!-- luke-docs:start:example -->

{Minimal TypeScript snippet showing the most common usage. Must be syntactically valid.}

<!-- luke-docs:end:example -->
```

---

## `docs/README.md` (documentation index)

```markdown
# Luke Documentation

<!-- luke-docs:start:index -->

{Index of the contents of docs/, with links and one descriptive line for each file/directory.
Generated from the file listing detected in Phase 1.

A directory gets one row. The decisions row is one link to the ADR index. The
repository-owned file is `docs/decisions/README.md`, but this template
generates `docs/README.md`, so the href is relative to it — emit
`[Architectural decisions](decisions/README.md)`, never a `docs/`-prefixed
path, which would resolve one directory too deep. Never a per-ADR table
either: that index is `adr`-owned, and a second copy here drifts from it and
hands both modes a reason to edit the other's file.}

<!-- luke-docs:end:index -->
```

---

## README quality checklist (verify before closing)

- [ ] No placeholder text (`TBD`, `…`, `{to be filled in}`)
- [ ] All code snippets are syntactically valid
- [ ] All internal links `[text](#anchor)` resolve to existing sections
- [ ] The root README → `docs/decisions/README.md` link resolves
- [ ] The listed env vars match the real `.env.production.example`
- [ ] The export list matches what `index.ts` actually exports
- [ ] No hardcoded version number (use `package.json` as source of truth)
- [ ] The "Monorepo Structure" table in the root README includes every workspace
