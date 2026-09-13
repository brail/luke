# @luke/db

<!-- luke-docs:start:overview -->
Database infrastructure of the monorepo: the multi-file Prisma schema, its versioned migrations, `prisma.config.ts`, the client generated from them, and `createPrismaClient` — the one place a `PrismaClient` is constructed. It owns no application behaviour: domain seeds and the operational `db:*` scripts stay in `@luke/api`, where the business rules they apply are written.
<!-- luke-docs:end:overview -->

## Used By

<!-- luke-docs:start:dependents -->
- `@luke/api` (`apps/api`) — constructs the runtime client in `server.ts`, imports every Prisma model and type, and runs the Prisma CLI from `PRISMA_PACKAGE_ROOT` (backup migration bridge, dev bootstrap, integration-test helpers)
- `@luke/nav` (`packages/nav`) — Prisma types and the client injected by the caller, for the `nav_*` replica upserts and for the PostgreSQL-side portfolio and KIMO queries
<!-- luke-docs:end:dependents -->

## Main Exports

<!-- luke-docs:start:exports -->
### Generated client (re-exported wholesale from `src/generated/prisma/client.js`)

| Symbol | Type | Description |
|--------|------|-------------|
| `PrismaClient` | class | The generated client. Constructed only by `createPrismaClient` |
| `Prisma` | namespace | Query input types, error classes and the `Prisma.sql` tagged template |
| `$Enums` | namespace | Schema enums (`Role`, `Provider`, `TokenType`, …) |
| `User`, `Brand`, `Season`, … | type | One row type per model in the schema |

The surface is exactly what `@prisma/client` used to answer for. It is re-exported with `export *` rather than a curated list, because a hand-written list would be a second, drifting copy of a file regenerated from the schema on every install.

### Package API

| Symbol | Type | Description |
|--------|------|-------------|
| `createPrismaClient` | function | Builds a client bound to Postgres through the `@prisma/adapter-pg` driver adapter; throws if neither `connectionString` nor `DATABASE_URL` is set |
| `CreatePrismaClientOptions` | type | `connectionString?` and `log?`, the two options the factory accepts |
| `PRISMA_PACKAGE_ROOT` | constant | The directory holding `prisma.config.ts`, and therefore the only correct `cwd` for a `prisma` CLI invocation |
| `PRISMA_DIR` | constant | The directory holding the `*.prisma` schema files and `migrations/` |
| `PRISMA_MIGRATIONS_DIR` | constant | The versioned migration folder, as bundled with this build |
<!-- luke-docs:end:exports -->

## Key Concepts

<!-- luke-docs:start:concepts -->
- **One construction point.** `createPrismaClient` is the only sanctioned way to build a `PrismaClient`; `.semgrep/rules/prisma-client-instantiation.yml` rejects `new PrismaClient(...)` everywhere except `src/client.ts`. The client constructor no longer accepts `datasources` or `datasourceUrl`, so a client built without the driver adapter does not reach the database the caller assumes — a regression that kept test helpers on SQLite for months. `DATABASE_URL` is infrastructural bootstrap under the Env Policy: it cannot come from AppConfig, which lives in the database that string opens.
- **A flat multi-file schema, split by domain.** `prisma/` holds `identity`, `platform`, `catalog`, `collection`, `merchandising`, `nav-analytics`, `company` and `calendar`, plus a header `schema.prisma` carrying only `generator` and `datasource`. `prisma.config.ts` declares `schema: 'prisma'`, so the CLI reads the whole directory rather than a single file.
- **Run the Prisma CLI from this package.** It is the only directory where config, schema and migrations resolve together, which is why `PRISMA_PACKAGE_ROOT` exists for callers that shell out. Scripts that connect to a database source `apps/api/.env` for `DATABASE_URL`: there is one database, and it is declared in one place.
- **The generated client is compiled source, not a prebuilt package.** The `prisma-client` generator emits TypeScript into `src/generated/`, which is gitignored and produced by `prisma generate` — run by the repository's `postinstall` and again by `build` before `tsc`. Consumers resolve `dist` through the `exports` map, never the generated sources.
- **Node only, at layer 0.** The adapter opens TCP sockets, so nothing in `apps/web` imports this package. It sits beside `@luke/core` rather than inside `@luke/api` because `@luke/nav` needs Prisma types and may not depend upwards on an app — a direction enforced by `tools/scripts/check-platform-integrity.ts`.
- **Migrations are versioned here; the data rules are not.** Generate one with `pnpm --filter @luke/db db:migrate:new <name>`, which spins up a throwaway Postgres and then applies the schema to the development database; the full procedure and its troubleshooting live in [`docs/prisma-migration-workflow.md`](../../docs/prisma-migration-workflow.md). Production applies them with `prisma migrate deploy` from `entrypoint.sh`, never `migrate reset`.
<!-- luke-docs:end:concepts -->

## Usage Example

<!-- luke-docs:start:example -->
```typescript
import { createPrismaClient, type PrismaClient, type User } from '@luke/db';

const prisma: PrismaClient = createPrismaClient({ log: ['warn', 'error'] });

export async function listActiveAdmins(): Promise<User[]> {
  return prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    orderBy: { username: 'asc' },
  });
}
```
<!-- luke-docs:end:example -->
