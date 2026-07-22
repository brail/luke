/**
 * Zod schemas for the full-system backup/restore feature (disaster recovery).
 */

import { z } from 'zod';

/** Literal confirmation phrase the admin must type to enable a restore — checked server-side too, not just as UI friction. */
export const BACKUP_RESTORE_CONFIRM_PHRASE = 'RIPRISTINA';

export const BackupScopeSchema = z.enum(['DB', 'DB_AND_FILES']);

/** Input schema for triggering a manual backup. */
export const BackupCreateInputSchema = z.object({
  scope: BackupScopeSchema,
  label: z.string().max(255).trim().optional(),
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
 * Input schema for a restore. `confirmPhrase` must equal `BACKUP_RESTORE_CONFIRM_PHRASE` —
 * validated server-side as a deliberate friction point for an irreversible operation, not merely
 * a UI-level nicety.
 */
export const BackupRestoreInputSchema = z.object({
  id: z.string().uuid('ID backup non valido'),
  preserveAuditLog: z.boolean(),
  restoreFiles: z.boolean(),
  confirmPhrase: z.literal(BACKUP_RESTORE_CONFIRM_PHRASE, {
    message: `Devi digitare esattamente "${BACKUP_RESTORE_CONFIRM_PHRASE}" per confermare`,
  }),
});

/** Full backup record as returned by the API. */
export const BackupRecordSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  scope: BackupScopeSchema,
  trigger: z.enum(['MANUAL', 'SCHEDULED', 'PRE_RESTORE_SAFETY']),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  sizeBytesEncrypted: z.string().nullable(), // BigInt serialized as string over the wire
  checksumSha256: z.string().nullable(),
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
export type BackupRecord = z.infer<typeof BackupRecordSchema>;
export type BackupScheduleConfig = z.infer<typeof BackupScheduleConfigSchema>;
