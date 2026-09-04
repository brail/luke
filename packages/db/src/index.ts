/**
 * `@luke/db` — the database infrastructure of the monorepo.
 *
 * It owns the Prisma schema, its versioned migrations, `prisma.config.ts`, the
 * client generated from them, and the factory that constructs that client. It
 * owns no application behaviour: domain seeds and one-shot administrative
 * operations stay in `@luke/api`, which is where the business rules they apply
 * are written.
 *
 * It exists because the generated client has to belong to *some* package. The
 * `prisma-client` generator emits TypeScript source into a directory rather
 * than hiding a package inside `node_modules`, and both `@luke/api` and
 * `@luke/nav` need the resulting types. `@luke/nav` may not import from
 * `@luke/api` (the dependency-direction policy in
 * `tools/scripts/check-platform-integrity.ts` forbids the upward edge), and
 * `@luke/core` ships to the browser, so neither of the existing packages could
 * hold it. This one sits at layer 0 beside `@luke/core`, Node-only, and both
 * consumers reach down into it.
 *
 * `export *` from the generated client rather than a curated list: the surface
 * is exactly what `@prisma/client` used to answer for — `PrismaClient`, the
 * `Prisma` namespace, `$Enums`, and one type per model — and re-listing it here
 * would be a second, drifting copy of a file that is regenerated from the
 * schema on every install.
 */

export * from './generated/prisma/client.js';

export { createPrismaClient, type CreatePrismaClientOptions } from './client.js';
export { PRISMA_DIR, PRISMA_MIGRATIONS_DIR, PRISMA_PACKAGE_ROOT } from './paths.js';
