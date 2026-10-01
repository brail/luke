# Prisma Migration Workflow

Every physical datamodel change — a model, enum, field, relation, mapping,
default, index or constraint, in any of the `packages/db/prisma/*.prisma` files —
requires a versioned migration. A change confined to `generator`/`datasource`
configuration in `schema.prisma` does not, when an authoritative
`prisma migrate diff` proves there is no physical schema difference (for example
the Cycle 11 generator switch).
The schema is multi-file: a `schema.prisma` holding only the generator and
datasource, plus one file per domain — `identity.prisma`, `platform.prisma`,
`catalog.prisma`, and so on. `prisma.config.ts` declares `schema: 'prisma'`, so
the CLI reads the whole `prisma/` directory, not a single file. The workflow
generates the migration against a temporary Postgres on port 5433, then aligns
the development database (port 5432) with `db push`.

The schema, the migrations and `prisma.config.ts` live in `@luke/db`, so every
`prisma` command runs from `packages/db/`: it is the only directory from which
the CLI resolves all three. The seed and the domain `db:*` scripts (bootstrap,
NAV reset, backfills) stay in `@luke/api`, because they apply business rules and
import `apps/api/src/`.

## Required workflow

```bash
pnpm --filter @luke/db db:migrate:new <descriptive_name>
git add packages/db/prisma/migrations packages/db/prisma/*.prisma
```

The script (`packages/db/scripts/new-migration.sh`) performs the four steps that
used to be manual: it starts the throwaway Postgres on 5433, waits until it
answers, generates the migration against it, stops it even when a step fails
midway, and aligns the development database with `db push`. The file it produces
in `prisma/migrations/` is committed together with the modified `.prisma` file or
files.

**Why a temporary database rather than the development one:** the development
database is aligned with `db push`, so its `_prisma_migrations` table does not
reflect the versioned history. `migrate dev` would read that as drift and offer to
reset it, deleting the data.

### Prisma 7 notes (for any `prisma` command run by hand)

- **`--skip-seed` no longer exists**, on neither `migrate dev` nor `migrate reset`.
- **The CLI no longer loads `.env` by itself.** A bare `npx prisma db push` fails
  with `The datasource.url property is required in your Prisma config file` — a
  misleading message, because `prisma.config.ts` does have a `datasource.url`: it
  reads it from `process.env.DATABASE_URL`, which is simply not populated. Load
  the environment first (`set -a && . ../../apps/api/.env && set +a`, as the
  scripts in `packages/db/package.json` do) or pass an explicit `--url`.
  The `.env` is the one in `apps/api`: `DATABASE_URL` is infrastructural bootstrap
  for the deployment (Env Policy in `CLAUDE.md`), not `@luke/db` configuration —
  there is one database, so it is declared in one place.

### Hand-written migrations

Two kinds of migration have no schema difference for `db:migrate:new` to generate, so they are
written by hand in `prisma/migrations/<timestamp>_<name>/migration.sql`:

- **A `CHECK` constraint Prisma does not model.** It has no representation in the `.prisma` files:
  `migrate diff` does not report it and `db push` never creates it. Document it with a `///`
  comment on the fields it covers, since the schema alone does not show it. Two exist:
  `company_profile_singleton` (`20260515000000_company_structure`) and the calendar date range
  (`20260929224334_calendar_dates_in_supported_years`).
- **A one-time rewrite of stored data** that must reach every database, restored backups included:
  only a versioned migration is replayed by the backup migration bridge, which a `db:*` script is
  not. Freeze in the file whatever application rule it applies (enum values, tables, permissions),
  so a replay on an older backup does not depend on later code, and state in its header whether
  it is safe to run twice. One exists: `20261001220553_section_access_leaf_overrides` (ADR-027),
  which is not. Ordinary backfills stay `db:*` scripts in `@luke/api`.

Check a hand-written migration from `packages/db/` on a throwaway database, as the CI
`migrations` job does — never with `db:migrate:deploy`, which loads `apps/api/.env` and targets
the development database:

```bash
docker run --rm -d --name luke-pg-migrate -p 5433:5432 \
  -e POSTGRES_USER=luke -e POSTGRES_PASSWORD=luke -e POSTGRES_DB=luke postgres:16-alpine
until docker exec luke-pg-migrate pg_isready -U luke -d luke; do sleep 1; done
docker exec luke-pg-migrate psql -U luke -d luke -c 'CREATE DATABASE luke_shadow'
export DATABASE_URL=postgresql://luke:luke@localhost:5433/luke
export SHADOW_DATABASE_URL=postgresql://luke:luke@localhost:5433/luke_shadow
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma --exit-code
docker stop luke-pg-migrate
```

The development database is aligned with `db push`, which neither creates a constraint nor runs a
data rewrite: apply the same SQL to it directly, **once** (`docker exec -i luke-db-1 psql -U luke -d
luke -v ON_ERROR_STOP=1 < prisma/migrations/<timestamp>_<name>/migration.sql`) — `psql` records
nothing, so a data rewrite that is not safe to run twice must not be applied again by hand. The
integration test database gets it on its own when it is created (`ensureTestSchema` runs `migrate
deploy` only while it has no `_prisma_migrations` table), so the persistent local one, on port 5434,
needs it by hand — from `packages/db/`, never through `db:migrate:deploy`, which targets the
development database:
`DATABASE_URL=postgresql://luke:luke_test@localhost:5434/luke_test pnpm exec prisma migrate deploy`.

## Production

- `apps/api/entrypoint.sh` runs `prisma migrate deploy` when the container boots.
- Never run `prisma migrate reset` in production.
- The `20260318134249_init` baseline is versioned in git (`prisma/migrations/` is
  not in `.gitignore`).

## Troubleshooting: `migrate deploy` blocked by `db push` drift

`db push` does not write to `_prisma_migrations`. If `migrate deploy` was run in
the past against the same development database, it can fail midway (for example
on a `CREATE TYPE` that already exists) and leave a row with
`finished_at = NULL` that blocks every later deploy.

**Diagnosis:**

```bash
docker exec luke-db-1 psql -U luke -d luke -c "SELECT migration_name FROM _prisma_migrations m1 WHERE finished_at IS NULL AND NOT EXISTS (SELECT 1 FROM _prisma_migrations m2 WHERE m2.migration_name = m1.migration_name AND m2.finished_at IS NOT NULL) ORDER BY migration_name;"
```

**Fix (development only, never in production):** check that the live schema
already reflects the net effect of the blocked migrations (compare `\d` output
with the content of `migration.sql`), then run
`prisma migrate resolve --applied <name>` for each of them in chronological order,
from `packages/db/` with the environment loaded
(`set -a && . ../../apps/api/.env && set +a`). Never run `resolve --applied`
without first verifying that the database really reflects that state.
