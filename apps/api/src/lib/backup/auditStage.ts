/**
 * Identity of the schema that holds the audit trail while a restore runs.
 *
 * Lives in its own module because both halves of the backup engine need it and neither should
 * import the other: `dumpPipeline` keeps these schemas out of every dump it writes, while
 * `restorePipeline` creates and consumes them.
 *
 * ## Why the name is unique per run
 *
 * `pg_restore --clean` drops and recreates everything the archive contains. A backup taken while
 * a stash existed — during a restore, or after one died and left its stash behind — captures that
 * schema, and it stays in that archive for good. Restoring such an archive then overwrites the
 * *live* stash with the archive's stale copy, and the events the stash was protecting are gone
 * before the merge ever reads them: the merge finds only rows the restore already put back and
 * reports zero reinstated.
 *
 * A per-run suffix closes that off by construction. An archive can only ever carry a name from an
 * earlier run, never the one this run just generated, so `--clean` cannot reach the live stash no
 * matter what the archive holds. Excluding the schemas at dump time keeps new archives clean too,
 * but it cannot fix archives already written — the unique name is what makes those safe to
 * restore.
 *
 * Note the exclusion belongs on `pg_dump` only. `pg_restore --exclude-schema` skips the objects
 * *inside* the schema while still emitting the schema's own `DROP SCHEMA`, which then fails
 * against the table it did not drop — turning every archive that contains a stash into an
 * unrestorable one.
 */

import { randomUUID } from 'crypto';

import { Prisma } from '@luke/db';

/** Shared prefix of every audit staging schema, past and present. */
export const AUDIT_STAGE_PREFIX = '_luke_restore_stage';

/** `--exclude-schema` argument for pg_dump. The pattern covers the prefix and every suffixed name. */
export const AUDIT_STAGE_EXCLUDE_ARG = `--exclude-schema=${AUDIT_STAGE_PREFIX}*`;

/** Generates the schema name for one restore run. Unique, so no archive can already contain it. */
export function newAuditStageSchema(): string {
  return `${AUDIT_STAGE_PREFIX}_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Renders a staging schema name as a SQL identifier.
 *
 * `Prisma.sql` parameterizes values, and a schema name is not one, so this is the one place that
 * has to bypass it. Safe because every name it is given comes from `newAuditStageSchema` or from
 * `information_schema` filtered on the prefix above — never from a caller. Do not extend this
 * pattern to a name derived from input: that is a SQL injection, and the quoting does not stop it.
 */
export function auditStageIdent(schema: string): Prisma.Sql {
  if (!schema.startsWith(AUDIT_STAGE_PREFIX)) {
    throw new Error(`Nome di schema di staging non valido: "${schema}"`);
  }
  return Prisma.raw(`"${schema}"`);
}
