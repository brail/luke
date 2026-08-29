/**
 * Zod schemas for the full-system backup/restore feature (disaster recovery).
 */

import { z } from 'zod';

/** Literal confirmation phrase the admin must type to enable a restore — checked server-side too, not just as UI friction. */
export const BACKUP_RESTORE_CONFIRM_PHRASE = 'RIPRISTINA';

export const BackupScopeSchema = z.enum(['DB', 'DB_AND_FILES']);

/** Optional free-text label, shared by any backup-creating input (manual create, import). */
const BackupLabelSchema = z.string().max(255).trim().optional();

/** Minimum passphrase length for a portable backup export/import package. */
export const BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH = 12;

/** Passphrase for a portable backup export/import package, shared by the export and import inputs. */
const BackupExportPassphraseSchema = z
  .string()
  .min(BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH, `La passphrase deve avere almeno ${BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH} caratteri`)
  .max(255);

/** Input schema for triggering a manual backup. */
export const BackupCreateInputSchema = z.object({
  scope: BackupScopeSchema,
  label: BackupLabelSchema,
});

/** Input schema for listing backups with cursor pagination. */
export const BackupListInputSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().min(1).max(100).default(50),
});

/** Schema for identifying a single backup by UUID. */
export const BackupIdSchema = z.object({
  id: z.string().uuid('ID backup non valido'),
});

/**
 * Input schema for a restore. `confirmPhrase` must equal `BACKUP_RESTORE_CONFIRM_PHRASE`.
 *
 * That check catches a call that omits or misspells the field, not a deliberate one: the phrase is
 * a public constant, and the client sends it whether or not anybody typed it. The friction is in
 * the dialog, which keeps its confirm button disabled until the typed phrase matches — this
 * schema cannot tell the two apart, and earlier wording here claimed otherwise.
 */
export const BackupRestoreInputSchema = z.object({
  id: z.string().uuid('ID backup non valido'),
  preserveAuditLog: z.boolean(),
  restoreFiles: z.boolean(),
  confirmPhrase: z.literal(BACKUP_RESTORE_CONFIRM_PHRASE, {
    message: `Devi digitare esattamente "${BACKUP_RESTORE_CONFIRM_PHRASE}" per confermare`,
  }),
});

/**
 * How a backup's `schemaMigrationName` compares to this instance's current one:
 * - `SAME`: identical, restore proceeds normally.
 * - `OLDER`: the backup predates one or more migrations still bundled with this instance —
 *   recoverable via the migration bridge (`runMigrationBridge`), never by restoring directly.
 * - `NEWER_OR_UNKNOWN`: the backup's migration isn't in this instance's bundled history at all
 *   (a newer Luke version, or an unrelated schema) — migrations have no maintained "down" path
 *   and several are structurally destructive, so this is a hard block with no bypass.
 */
export const SchemaCompatibilitySchema = z.enum(['SAME', 'OLDER', 'NEWER_OR_UNKNOWN']);

/** Result of `classifySchemaCompatibility` — shared between the API's migration-bridge engine and the tRPC output below. */
export const SchemaCompatibilityResultSchema = z.object({
  classification: SchemaCompatibilitySchema,
  currentSchemaMigrationName: z.string().nullable(),
  /** Populated only when `classification === 'OLDER'`: the migrations that will be replayed, in order. */
  pendingMigrations: z.array(z.string()),
});

/** Output of `maintenance.backup.checkRestoreCompatibility`. */
export const CheckRestoreCompatibilityOutputSchema = SchemaCompatibilityResultSchema.extend({
  backupSchemaMigrationName: z.string().nullable(),
});

/** Input schema for running the migration bridge on a backup classified `OLDER`. */
export const RunMigrationBridgeInputSchema = BackupIdSchema.extend({
  acknowledgeMigrationBridge: z.literal(true, {
    message: 'Devi confermare per procedere',
  }),
});

/** Input schema for preparing a passphrase-protected, instance-portable backup export. */
export const BackupExportInputSchema = z.object({
  id: z.string().uuid('ID backup non valido'),
  passphrase: BackupExportPassphraseSchema,
});

/** Multipart text fields accompanying an uploaded export package on `/upload/backup-import`. */
export const BackupImportFieldsSchema = z.object({
  passphrase: BackupExportPassphraseSchema,
  label: BackupLabelSchema,
});

/** A backup's DEK, wrapped a second time with a key derived from a user passphrase (Argon2id) — additive to the server-master-key wrapping, so the package is decryptable without access to `~/.luke/secret.key`. */
export const PassphraseWrappedDekSchema = z.object({
  saltHex: z.string(),
  ivHex: z.string(),
  authTagHex: z.string(),
  ciphertextHex: z.string(),
});

/**
 * Header prepended to a `.lukebak` export package (see `apps/api/src/lib/backup/exportFormat.ts`):
 * everything needed to decrypt the backup body given only the passphrase, independent of which
 * server instance originally created it or will later import it.
 */
export const BackupExportHeaderSchema = z.object({
  version: z.literal(1),
  backupId: z.string().uuid(),
  scope: BackupScopeSchema,
  algorithm: z.literal('aes-256-gcm'),
  kdf: z.literal('argon2id'),
  passphraseWrapped: PassphraseWrappedDekSchema,
  bodyIvHex: z.string(),
  bodyAuthTagHex: z.string(),
  checksumSha256: z.string(),
  sizeBytesEncrypted: z.string(),
  appVersion: z.string().nullable(),
  schemaMigrationName: z.string().nullable(),
  createdAt: z.string(),
});

/** Full backup record as returned by the API. */
export const BackupRecordSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  scope: BackupScopeSchema,
  trigger: z.enum(['MANUAL', 'SCHEDULED', 'PRE_RESTORE_SAFETY', 'IMPORTED', 'PRE_MIGRATION_SAFETY', 'MIGRATED']),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  label: z.string().nullable(),
  sourceBackupId: z.string().nullable(),
  sizeBytesEncrypted: z.string().nullable(), // BigInt serialized as string over the wire
  checksumSha256: z.string().nullable(),
  fileCount: z.number().int().nullable(),
  appVersion: z.string().nullable(),
  schemaMigrationName: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdById: z.string().nullable(),
  // tRPC has no superjson transformer configured — Dates cross the wire as ISO strings.
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Form/input schema for the automatic-backup schedule + retention settings (one AppConfig key each). */
export const BackupScheduleConfigSchema = z.object({
  enabled: z.boolean(),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato orario non valido (HH:mm)'),
  scope: BackupScopeSchema,
  retentionDays: z.number().int().min(1).max(3650),
  retentionMinCount: z.number().int().min(0).max(1000),
  notifyOnFailure: z.boolean(),
});

export type BackupScope = z.infer<typeof BackupScopeSchema>;
export type BackupCreateInput = z.infer<typeof BackupCreateInputSchema>;
export type BackupListInput = z.infer<typeof BackupListInputSchema>;
export type BackupId = z.infer<typeof BackupIdSchema>;
export type BackupRestoreInput = z.infer<typeof BackupRestoreInputSchema>;
export type SchemaCompatibility = z.infer<typeof SchemaCompatibilitySchema>;
export type SchemaCompatibilityResult = z.infer<typeof SchemaCompatibilityResultSchema>;
export type CheckRestoreCompatibilityOutput = z.infer<typeof CheckRestoreCompatibilityOutputSchema>;
export type RunMigrationBridgeInput = z.infer<typeof RunMigrationBridgeInputSchema>;
export type BackupExportInput = z.infer<typeof BackupExportInputSchema>;
export type BackupImportFields = z.infer<typeof BackupImportFieldsSchema>;
export type PassphraseWrappedDek = z.infer<typeof PassphraseWrappedDekSchema>;
export type BackupExportHeader = z.infer<typeof BackupExportHeaderSchema>;
export type BackupRecord = z.infer<typeof BackupRecordSchema>;
export type BackupScheduleConfig = z.infer<typeof BackupScheduleConfigSchema>;
