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

## How to read the tables below

Each README is a title line, then one section per table row, **in table order**.
A row with a heading is written as:

```markdown
## {Heading}

<!-- luke-docs:start:{marker} -->

{content, as the row describes it}

<!-- luke-docs:end:{marker} -->
```

A row whose heading is `—` has no heading of its own: its marker block sits
directly under the title. Text in the Content column is an instruction, never
copied as is, except where it is quoted as the literal line to write.

---

## `/README.md` (root)

Title: `# Luke`

| Heading | Marker | Content |
| --- | --- | --- |
| — | `overview` | 1-2 paragraphs: what Luke is, who uses it, what problem it solves — FEBOS/BLAUER, internal B2B, collection management, season planning, sourcing, merchandise planning. Mention ISO 9001 and NAV integration if relevant. |
| Monorepo Structure | `structure` | Table: Workspace \| Type \| Description — generate from the Phase 1 dictionary. |
| Prerequisites | `prerequisites` | Required runtimes: Node.js, pnpm, Docker, PostgreSQL, S3-compatible storage, MSSQL for NAV sync. Name them without versions; manifests and runtime configuration are the live sources. |
| Quick Start | `quickstart` | Bash block: pnpm install; `docker compose -f docker-compose.dev.yml up -d` (development PostgreSQL and S3 storage); create `apps/api/.env` with `DATABASE_URL` and `NODE_ENV=development` — there is no `.env.example` to copy; `pnpm --filter "@luke/api..." build` — a full `pnpm build` also builds the web for production, which needs `NEXTAUTH_SECRET`; `pnpm --filter @luke/api db:bootstrap` (reset, migrations, administrator and base configuration); `pnpm db:seed` with `DATABASE_URL` in the shell (reference data — it does not read `apps/api/.env`); pnpm dev. |
| Available Scripts | `scripts` | Table of relevant root-level scripts: dev, build, lint, typecheck, test, db:seed. Only scripts a root or workspace `package.json` defines. |
| Deployment | `deployment` | 3-4 sentences: conventional tag → GitHub Actions → ghcr.io → manual redeploy of the stack. Don't invent details you can't verify from the codebase. |
| Architecture | `architecture` | Short paragraph: stack, main patterns (end-to-end tRPC types, RBAC, NAV sync). Link to docs/decisions/ for architectural decisions. |
| Architectural Decisions | `adr-link` | Literal line: ``Relevant architectural decisions are documented in [`docs/decisions/`](docs/decisions/README.md).`` |
| Release | `release` | Conventional commits + git-cliff for automatic CHANGELOG. Tag naming: vX.Y.Z. commitlint + husky hooks active. |

---

## `apps/web/README.md`

Title: `# apps/web — Luke Frontend`

| Heading | Marker | Content |
| --- | --- | --- |
| — | `overview` | Framework and UI layer, named but never versioned — read the versions from apps/web/package.json and the routing style from the app directory. What it renders, who uses it. |
| Main Routes | `routes` | 2-level directory tree of `src/app/` with one descriptive line for each. Use markdown indentation, not a table. |
| Internal Dependencies | `internal-deps` | List of internal packages/ imported by this app. |
| Environment Variables | `env` | Table: Variable \| Description \| Required. Only the ones consumed by web. |
| Local Development | `dev` | Command to start dev from the monorepo root and from the app's directory. |

---

## `apps/api/README.md`

Title: `# apps/api — Luke Backend`

| Heading | Marker | Content |
| --- | --- | --- |
| — | `overview` | Server stack, named but never versioned — read the versions from apps/api/package.json. What it exposes (tRPC endpoint, any REST). |
| tRPC Routers | `trpc-routers` | List of router namespaces (from the file listing in `src/routers/`). Format: `namespace.*` — short description. |
| Internal Packages | `internal-deps` | List of imported packages/. |
| Environment Variables | `env` | Table: Variable \| Type \| Default \| Description. Sources: `.env.production.example` + env policy in CLAUDE.md. `NODE_ENV` has no default: only `development` and `production` change the runtime posture, and any other value or none runs as neither (`isDevelopment()` in `packages/core/src/runtime/env.ts`); `test` additionally registers a test-only route in `apps/api/src/server.ts`. Mention `assertEnvPolicy()` in `apps/api/src/server.ts` (production enforcement). |
| Database | `database` | PostgreSQL + Prisma. migrate + studio commands. List of models detected in Phase 1. |
| NAV Sync | `nav` | packages/nav, direct MSSQL (no DAB), one-way NAV → Luke sync. NAV config read from AppConfig, not from env. |
| Storage | `storage` | IStorageProvider provider. Valid buckets: point to `APP_STORAGE_BUCKETS` in `packages/core/src/storage/types.ts`, the only list (`isValidBucket()` derives from it and also admits the internal `backups` bucket) — don't hardcode it. Content-addressed SHA256 key for revision photos. |

---

## `packages/*/README.md` (one per package)

Title: `# @luke/{name}`

| Heading | Marker | Content |
| --- | --- | --- |
| — | `overview` | 1 sentence: what this package does, what domain problem it solves. |
| Used By | `dependents` | List of apps/packages that import from this package — from the Phase 1 dictionary. |
| Main Exports | `exports` | Table or list: Symbol \| Type \| Short description. Only public exports from `src/index.ts`. Max 20 rows — if there are too many exports, group by category. |
| Key Concepts | `concepts` | 3-6 bullet points on non-obvious behaviors, patterns, architectural constraints of the package. |
| Usage Example | `example` | Minimal TypeScript snippet showing the most common usage. Must be syntactically valid. |

---

## `docs/README.md` (documentation index)

Title: `# Luke Documentation`

| Heading | Marker | Content |
| --- | --- | --- |
| — | `index` | Index of the contents of docs/, with links and one descriptive line for each file/directory. Generated from the file listing detected in Phase 1. A directory gets one row. The decisions row is one link to the ADR index. The repository-owned file is `docs/decisions/README.md`, but this template generates `docs/README.md`, so the href is relative to it — emit `[Architectural decisions](decisions/README.md)`, never a `docs/`-prefixed path, which would resolve one directory too deep. Never a per-ADR table either: that index is `adr`-owned, and a second copy here drifts from it and hands both modes a reason to edit the other's file. |

---

## README quality checklist (verify before closing)

- [ ] No placeholder text (`TBD`, `…`, `{to be filled in}`)
- [ ] All code snippets are syntactically valid
- [ ] `pnpm check:drift` passes supported heading-fragment and owned-index checks;
      parser limits are documented in `tools/README.md`, not silently assumed covered
- [ ] The root README → `docs/decisions/README.md` link resolves
- [ ] The listed env vars match the real `.env.production.example`
- [ ] The export list matches what `index.ts` actually exports
- [ ] No hardcoded version number (use `package.json` as source of truth)
- [ ] The "Monorepo Structure" table in the root README includes every workspace
