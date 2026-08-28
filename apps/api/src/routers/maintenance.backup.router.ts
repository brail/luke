/**
 * tRPC router for the full-system backup/restore system (disaster recovery).
 *
 * `create` starts the job in the background (fire-and-forget: `runBackupJob` never throws,
 * it captures every error in the record itself) — the frontend polls `getById`/`list` for status.
 * `restore` is synchronous instead: it first creates a pre-restore safety snapshot (mandatory,
 * cannot be disabled — if it fails the restore is aborted without touching anything), then runs
 * `runRestoreJob` (which throws on error, unlike the backup job).
 */

import { TRPCError } from '@trpc/server';

import {
  BackupCreateInputSchema,
  BackupExportInputSchema,
  BackupIdSchema,
  BackupListInputSchema,
  BackupRestoreInputSchema,
  BackupScheduleConfigSchema,
  RunMigrationBridgeInputSchema,
  type BackupExportHeader,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { unwrapDek, wrapDekWithPassphrase } from '../lib/backup/crypto';
import { createPendingBackupRecord, deleteBackupBlob, runBackupJob } from '../lib/backup/dumpPipeline';
import { classifySchemaCompatibility, runMigrationBridgeJob } from '../lib/backup/migrationBridge';
import { assertPgToolchainCompatible, runRestoreJob } from '../lib/backup/restorePipeline';
import { getBackupScheduleSettings, saveConfig } from '../lib/configManager';
import { forceLogoutNonAdmins, writeMaintenanceState } from '../lib/maintenanceMode';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { getStorageProvider } from '../storage';
import { signDownloadToken, signExportToken } from '../utils/downloadToken';

const BACKUP_SELECT = {
  id: true,
  filename: true,
  scope: true,
  trigger: true,
  status: true,
  label: true,
  sizeBytesEncrypted: true,
  checksumSha256: true,
  fileCount: true,
  appVersion: true,
  schemaMigrationName: true,
  errorMessage: true,
  createdById: true,
  sourceBackupId: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

/** Serializes a BackupRecord row for the wire — BigInt has no native JSON representation. */
function serializeRecord<T extends { sizeBytesEncrypted: bigint | null }>(
  record: T
): Omit<T, 'sizeBytesEncrypted'> & { sizeBytesEncrypted: string | null } {
  return { ...record, sizeBytesEncrypted: record.sizeBytesEncrypted?.toString() ?? null };
}

export const backupRouter = router({
  /**
   * Lists backups, newest first, with cursor-based pagination.
   *
   * @auth {maintenance:read}
   * @input Optional `{ limit?, cursor? }` — defaults to 50 items, no cursor (first page).
   * @output `{ items: BackupRecord[], nextCursor?: string }` — serialized records (BigInt sizes as
   * strings) plus a cursor for the next page when more exist.
   */
  list: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .input(BackupListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const items = await ctx.prisma.backupRecord.findMany({
        select: BACKUP_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;

      return {
        items: results.map(serializeRecord),
        nextCursor: hasMore ? results[results.length - 1]?.id : undefined,
      };
    }),

  /**
   * Returns a single backup's current state — used by the frontend to poll job progress.
   *
   * @auth {maintenance:read}
   * @input `{ id: string }` — the backup record id.
   * @output The serialized `BackupRecord`, or `NOT_FOUND` if it doesn't exist.
   */
  getById: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .input(BackupIdSchema)
    .query(async ({ ctx, input }) => {
      const record = await ctx.prisma.backupRecord.findUnique({
        where: { id: input.id },
        select: BACKUP_SELECT,
      });
      if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Backup non trovato' });
      return serializeRecord(record);
    }),

  /**
   * Mints a short-lived (5 min) signed download token for a completed backup's encrypted blob,
   * to be appended to `/download/backup/:id?token=...`.
   *
   * No UI calls this: the Download button was removed once it became clear the raw `.enc` blob
   * is not usable on its own. Its DEK is wrapped with *this* server's master key, and the iv and
   * auth tag live in `BackupRecord`/the `.meta.json` sidecar, none of which travel with the
   * downloaded file. `prepareExport` (`.lukebak`) is the portable artifact. This is kept only for
   * fetching the raw blob by hand alongside its sidecar; if that need never materializes, this
   * procedure and its route are dead weight and should go.
   *
   * @auth {maintenance:read}
   * @input `{ id: string }` — the backup record id.
   * @output `{ token, filename }` — signed download token and the blob's filename.
   */
  getDownloadLink: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .input(BackupIdSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.prisma.backupRecord.findUnique({ where: { id: input.id } });
      if (!record || record.status !== 'COMPLETED' || !record.filename) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Backup non trovato o non completato' });
      }

      const token = signDownloadToken({ bucket: 'backups', key: record.filename });
      return { token, filename: record.filename };
    }),

  /**
   * Prepares a passphrase-protected, instance-portable export package (`.lukebak`) for a
   * completed backup: unwraps its DEK with the server master key, re-wraps it with a key derived
   * from the given passphrase (Argon2id), and mints a signed token embedding that re-wrapped
   * envelope so `/download/backup/:id/export` can stream the package without hitting the DB
   * again. The passphrase itself is never persisted or included in the token.
   *
   * @auth {maintenance:backup_export}
   * @input `{ id: string, passphrase: string }` — backup id and the export passphrase.
   * @output `{ token, filename }` — signed export token and the `.lukebak` filename.
   */
  prepareExport: protectedProcedure
    .use(requirePermission('maintenance:backup_export'))
    .input(BackupExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.prisma.backupRecord.findUnique({ where: { id: input.id } });
      if (!record || record.status !== 'COMPLETED' || !record.filename) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Backup non trovato o non completato' });
      }
      if (!record.ivHex || !record.authTagHex || !record.wrappedDekHex || !record.checksumSha256) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Metadati crittografici del backup mancanti' });
      }

      const dek = unwrapDek(record.wrappedDekHex);
      const passphraseWrapped = await wrapDekWithPassphrase(dek, input.passphrase);

      const header: BackupExportHeader = {
        version: 1,
        backupId: record.id,
        scope: record.scope,
        algorithm: 'aes-256-gcm',
        kdf: 'argon2id',
        passphraseWrapped,
        bodyIvHex: record.ivHex,
        bodyAuthTagHex: record.authTagHex,
        checksumSha256: record.checksumSha256,
        sizeBytesEncrypted: record.sizeBytesEncrypted?.toString() ?? '0',
        appVersion: record.appVersion,
        schemaMigrationName: record.schemaMigrationName,
        createdAt: (record.completedAt ?? record.createdAt).toISOString(),
      };

      const token = signExportToken({ bucket: 'backups', key: record.filename, header });

      await logAudit(ctx, {
        action: 'BACKUP_EXPORT',
        targetType: 'BackupRecord',
        targetId: record.id,
        result: 'SUCCESS',
        metadata: { scope: record.scope },
      });

      return { token, filename: `${record.id}.lukebak` };
    }),

  /**
   * Classifies a backup's schema against this instance's current one (SAME/OLDER/NEWER_OR_UNKNOWN)
   * — the frontend uses this to decide which of the three restore-dialog branches to show before
   * the admin even attempts anything.
   *
   * @auth {maintenance:read}
   * @input `{ id: string }` — the backup record id.
   * @output Compatibility classification plus `backupSchemaMigrationName`.
   */
  checkRestoreCompatibility: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .input(BackupIdSchema)
    .query(async ({ ctx, input }) => {
      const target = await ctx.prisma.backupRecord.findUnique({
        where: { id: input.id },
        select: { schemaMigrationName: true },
      });
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Backup non trovato' });

      const compat = await classifySchemaCompatibility(ctx.prisma, target.schemaMigrationName);
      return { ...compat, backupSchemaMigrationName: target.schemaMigrationName };
    }),

  /**
   * Triggers a manual backup. Returns immediately with the record id (status PENDING);
   * the job itself runs in the background.
   *
   * @auth {maintenance:backup_create}
   * @input `{ scope, label? }` — backup scope and optional label.
   * @output `{ id: string }` — the new (pending) backup record's id.
   */
  create: protectedProcedure
    .use(requirePermission('maintenance:backup_create'))
    .input(BackupCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await createPendingBackupRecord(ctx.prisma, {
        scope: input.scope,
        trigger: 'MANUAL',
        createdById: ctx.session.user.id,
        label: input.label,
      });

      // Fire-and-forget: runBackupJob never throws, it captures every error in the record itself.
      void runBackupJob({
        prisma: ctx.prisma,
        backupId: record.id,
        scope: input.scope,
        logger: ctx.logger,
      });

      await logAudit(ctx, {
        action: 'BACKUP_CREATE',
        targetType: 'BackupRecord',
        targetId: record.id,
        result: 'SUCCESS',
        metadata: { scope: input.scope, trigger: 'MANUAL' },
      });

      return { id: record.id };
    }),

  /**
   * Runs the migration bridge on a backup classified `OLDER`: creates a disposable temp database,
   * restores the old backup into it, snapshots it (`PRE_MIGRATION_SAFETY`), applies the missing
   * migrations there, and saves the result as a new `MIGRATED` backup. Never touches this
   * instance's real database. Fire-and-forget like `create` — the bridge can take minutes (restore
   * + dump + migrate + dump again), so the mutation returns immediately with the new backup's id
   * (status PENDING) and the frontend polls `list` for progress, same as any other backup job.
   *
   * @auth {maintenance:backup_restore}
   * @input `{ id: string }` — the source backup record id.
   * @output `{ id: string }` — the new `MIGRATED` backup record's id (status PENDING).
   */
  runMigrationBridge: protectedProcedure
    .use(requirePermission('maintenance:backup_restore'))
    .input(RunMigrationBridgeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.backupRecord.findUnique({ where: { id: input.id } });
      if (!target || target.status !== 'COMPLETED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Backup non trovato o non completato' });
      }
      if (!target.ivHex || !target.authTagHex || !target.wrappedDekHex) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Metadati crittografici del backup mancanti' });
      }

      // Always re-validates server-side, never trust the classification shown to the client.
      const compat = await classifySchemaCompatibility(ctx.prisma, target.schemaMigrationName);
      if (compat.classification !== 'OLDER' || !target.schemaMigrationName || !compat.currentSchemaMigrationName) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Questo backup non ha uno schema più vecchio di quello corrente: il migration bridge non si applica.',
        });
      }

      // Same pg_restore, same skew — the bridge restores into a temp database on this same server.
      try {
        await assertPgToolchainCompatible(ctx.prisma);
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        });
      }

      const migrated = await createPendingBackupRecord(ctx.prisma, {
        scope: 'DB',
        trigger: 'MIGRATED',
        createdById: ctx.session.user.id,
        sourceBackupId: target.id,
      });

      // Fire-and-forget: runMigrationBridgeJob never throws, it captures every error in the record itself.
      void runMigrationBridgeJob({
        prisma: ctx.prisma,
        migratedBackupId: migrated.id,
        sourceBackup: {
          id: target.id,
          filename: target.filename,
          ivHex: target.ivHex,
          authTagHex: target.authTagHex,
          wrappedDekHex: target.wrappedDekHex,
          schemaMigrationName: target.schemaMigrationName,
        },
        pendingMigrations: compat.pendingMigrations,
        currentSchemaMigrationName: compat.currentSchemaMigrationName,
        createdById: ctx.session.user.id,
        logger: ctx.logger,
      });

      await logAudit(ctx, {
        action: 'BACKUP_MIGRATION_BRIDGE',
        targetType: 'BackupRecord',
        targetId: target.id,
        result: 'SUCCESS',
        metadata: { migratedBackupId: migrated.id, migrationsApplied: compat.pendingMigrations.length },
      });

      return { id: migrated.id };
    }),

  /**
   * Deletes a backup: removes the encrypted blob + sidecar from storage, then the DB record.
   *
   * @auth {maintenance:backup_delete}
   * @input `{ id: string }` — the backup record id.
   * @output `{ success: true }`
   */
  delete: protectedProcedure
    .use(requirePermission('maintenance:backup_delete'))
    .input(BackupIdSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.prisma.backupRecord.findUnique({ where: { id: input.id } });
      if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Backup non trovato' });

      if (record.filename) {
        const provider = await getStorageProvider(ctx.prisma);
        await deleteBackupBlob(provider, record.id).catch(() => { /* best-effort */ });
      }
      await ctx.prisma.backupRecord.delete({ where: { id: input.id } });

      await logAudit(ctx, {
        action: 'BACKUP_DELETE',
        targetType: 'BackupRecord',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { scope: record.scope, filename: record.filename },
      });

      return { success: true };
    }),

  /**
   * Restores the database (and optionally storage files) from a completed backup.
   * Always creates a PRE_RESTORE_SAFETY snapshot first — if that fails, the restore is
   * aborted before anything is touched.
   *
   * @auth {maintenance:backup_restore}
   * @input `{ id: string, preserveAuditLog: boolean, restoreFiles: boolean }`
   * @output `{ success: true, safetySnapshotId: string }`
   */
  restore: protectedProcedure
    .use(requirePermission('maintenance:backup_restore'))
    .input(BackupRestoreInputSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.backupRecord.findUnique({ where: { id: input.id } });
      if (!target || target.status !== 'COMPLETED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Backup non trovato o non completato' });
      }
      if (!target.ivHex || !target.authTagHex || !target.wrappedDekHex) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Metadati crittografici del backup mancanti' });
      }

      // A backup with a schema different from the current one can leave the DB in an inconsistent
      // state after pg_restore --clean (missing/unexpected columns, unknown enums). SAME proceeds as
      // usual; OLDER must first be brought to the current schema via the migration bridge;
      // NEWER_OR_UNKNOWN is a hard block with no bypass (migrations are forward-only, going backward
      // would mean inventing legitimately deleted data).
      const compat = await classifySchemaCompatibility(ctx.prisma, target.schemaMigrationName);
      if (compat.classification !== 'SAME') {
        const message = compat.classification === 'NEWER_OR_UNKNOWN'
          ? `Schema del backup ("${target.schemaMigrationName}") più recente o sconosciuto rispetto a quello corrente ("${compat.currentSchemaMigrationName}"). Aggiorna questa istanza a una versione ≥ di quella del backup, poi riprova.`
          : `Schema del backup ("${target.schemaMigrationName}") più vecchio di quello corrente ("${compat.currentSchemaMigrationName}"). Usa prima "Applica migrazioni", poi ripristina il risultato.`;
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
      }

      // Before anything irreversible: a pg_restore whose major differs from the server's aborts on
      // its own prologue. Caught here, that costs nothing; caught inside runRestoreJob it would
      // already have taken a safety snapshot and put the instance into Maintenance Mode.
      try {
        await assertPgToolchainCompatible(ctx.prisma);
      } catch (err) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        });
      }

      // Mandatory safety snapshot: if it fails, the restore doesn't start — nothing has been touched.
      const safety = await createPendingBackupRecord(ctx.prisma, {
        scope: 'DB',
        trigger: 'PRE_RESTORE_SAFETY',
        createdById: ctx.session.user.id,
      });
      await runBackupJob({ prisma: ctx.prisma, backupId: safety.id, scope: 'DB', logger: ctx.logger });
      const safetyResult = await ctx.prisma.backupRecord.findUnique({
        where: { id: safety.id },
        select: { status: true, errorMessage: true },
      });
      if (safetyResult?.status !== 'COMPLETED') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Snapshot di sicurezza pre-restore fallito, restore annullato: ${safetyResult?.errorMessage ?? 'errore sconosciuto'}`,
        });
      }

      const baseMeta = { preserveAuditLog: input.preserveAuditLog, restoreFiles: input.restoreFiles };

      // Blocks all non-admin traffic (reads included) and invalidates their sessions before
      // touching the DB — a restore is already a deliberate action, so activation is immediate,
      // not scheduled. Stays ACTIVE even after the restore completes: an admin must end it
      // explicitly after verifying that everything works.
      await writeMaintenanceState(ctx.prisma, {
        status: 'ACTIVE',
        scheduledAt: null,
        activatedAt: new Date().toISOString(),
        message: 'Ripristino database in corso',
        forceLogout: true,
        warningLeadMinutes: [],
        warningsSent: [],
        activatedByUserId: ctx.session.user.id,
        notifyByEmail: false,
      });
      await forceLogoutNonAdmins(ctx.prisma);
      await logAudit(ctx, {
        action: 'MAINTENANCE_MODE_ACTIVATED',
        targetType: 'MaintenanceMode',
        result: 'SUCCESS',
        metadata: { trigger: 'RESTORE', forceLogout: true },
      });

      try {
        await runRestoreJob({
          prisma: ctx.prisma,
          filename: target.filename,
          ivHex: target.ivHex,
          authTagHex: target.authTagHex,
          wrappedDekHex: target.wrappedDekHex,
          preserveAuditLog: input.preserveAuditLog,
          restoreFiles: input.restoreFiles,
          logger: ctx.logger,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logAudit(ctx, {
          action: 'BACKUP_RESTORE',
          targetType: 'BackupRecord',
          targetId: target.id,
          result: 'FAILURE',
          metadata: { ...baseMeta, errorCode: message.slice(0, 200) },
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Restore fallito: ${message}`, cause: err });
      }

      await logAudit(ctx, {
        action: 'BACKUP_RESTORE',
        targetType: 'BackupRecord',
        targetId: target.id,
        result: 'SUCCESS',
        metadata: { ...baseMeta, safetySnapshotId: safety.id },
      });

      return { success: true, safetySnapshotId: safety.id };
    }),

  /**
   * Returns the current automatic-backup schedule + retention settings, with defaults
   * filled in for any AppConfig key that hasn't been set yet.
   *
   * @auth {maintenance:read}
   * @input None
   * @output Schedule/retention settings: `{ enabled, dailyTime, scope, retentionDays,
   * retentionMinCount, notifyOnFailure }`.
   */
  getScheduleConfig: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .query(({ ctx }) => getBackupScheduleSettings(ctx.prisma)),

  /**
   * Updates the automatic-backup schedule + retention settings in AppConfig.
   *
   * @auth {maintenance:update}
   * @input `{ enabled, dailyTime, scope, retentionDays, retentionMinCount, notifyOnFailure }`
   * @output `{ success: true }`
   */
  updateScheduleConfig: protectedProcedure
    .use(requirePermission('maintenance:update'))
    .input(BackupScheduleConfigSchema)
    .mutation(async ({ ctx, input }) => {
      await Promise.all([
        saveConfig(ctx.prisma, 'backup.schedule.enabled', input.enabled.toString(), false),
        saveConfig(ctx.prisma, 'backup.schedule.dailyTime', input.dailyTime, false),
        saveConfig(ctx.prisma, 'backup.schedule.scope', input.scope, false),
        saveConfig(ctx.prisma, 'backup.retentionDays', input.retentionDays.toString(), false),
        saveConfig(ctx.prisma, 'backup.retentionMinCount', input.retentionMinCount.toString(), false),
        saveConfig(ctx.prisma, 'backup.notifyOnFailure', input.notifyOnFailure.toString(), false),
      ]);

      await logAudit(ctx, {
        action: 'BACKUP_SCHEDULE_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { ...input },
      });

      return { success: true };
    }),
});
