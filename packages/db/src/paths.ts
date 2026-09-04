/**
 * Filesystem anchors for the Prisma CLI and for anything that reads the
 * migration folder at runtime.
 *
 * The schema, the migrations and `prisma.config.ts` live in this package, so
 * the paths to them are this package's to state. Before, every caller counted
 * `../` segments from its own file down to `apps/api/prisma/` — the migration
 * bridge from `src/lib/backup/`, the test helper from `test/helpers/` — and a
 * file that moved directory took a silently wrong path with it.
 *
 * Both `src/` and `dist/` sit exactly one level under the package root, so the
 * same expression is correct whether this module is running from source (tsx)
 * or from the build (`@luke/db`'s `exports` map, which is what every consumer
 * and the runtime image resolve).
 */

import { join } from 'path';

/**
 * The package root: the directory holding `prisma.config.ts`, and therefore the
 * only correct `cwd` for a `prisma` CLI invocation.
 */
export const PRISMA_PACKAGE_ROOT = join(__dirname, '..');

/** The directory holding `schema.prisma` and `migrations/`. */
export const PRISMA_DIR = join(PRISMA_PACKAGE_ROOT, 'prisma');

/** The versioned migration folder, as bundled with this build. */
export const PRISMA_MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');
