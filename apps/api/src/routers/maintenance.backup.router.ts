/**
 * Router tRPC per il sistema di backup/restore full-system (disaster recovery).
 *
 * `create` avvia il job in background (fire-and-forget: `runBackupJob` non lancia mai,
 * cattura ogni errore nel record stesso) — il frontend fa polling di `getById`/`list` per lo stato.
 * `restore` invece è sincrona: crea prima uno snapshot di sicurezza pre-restore (obbligatorio,
 * non disattivabile — se fallisce il restore viene abortito senza toccare nulla), poi esegue
 * `runRestoreJob` (che lancia in caso di errore, a differenza del job di backup).
 */

import { TRPCError } from '@trpc/server';

import {
  BackupCreateInputSchema,
  BackupIdSchema,
  BackupListInputSchema,
  BackupRestoreInputSchema,
  BackupScheduleConfigSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { createPendingBackupRecord, deleteBackupBlob, runBackupJob } from '../lib/backup/dumpPipeline';
import { runRestoreJob } from '../lib/backup/restorePipeline';
import { getBackupScheduleSettings, saveConfig } from '../lib/configManager';
import { forceLogoutNonAdmins, writeMaintenanceState } from '../lib/maintenanceMode';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { getStorageProvider } from '../storage';
import { signDownloadToken } from '../utils/downloadToken';

const BACKUP_SELECT = {
  id: true,
  filename: true,
  scope: true,
  trigger: true,
  status: true,
  sizeBytesEncrypted: true,
  checksumSha256: true,
  appVersion: true,
  schemaMigrationName: true,
  errorMessage: true,
  createdById: true,
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
   * Mints a short-lived (5 min) signed download token for a completed backup's encrypted blob.
   * The frontend appends it to `/maintenance/backup/:id/download?token=...` and downloads via a
   * native `<a href>` — no Bearer header, no buffering the whole file into a JS `Blob` first.
   *
   * @auth {maintenance:read}
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
   * Triggers a manual backup. Returns immediately with the record id (status PENDING);
   * the job itself runs in the background.
   *
   * @auth {maintenance:backup_create}
   */
  create: protectedProcedure
    .use(requirePermission('maintenance:backup_create'))
    .input(BackupCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await createPendingBackupRecord(ctx.prisma, {
        scope: input.scope,
        trigger: 'MANUAL',
        createdById: ctx.session.user.id,
      });

      // Fire-and-forget: runBackupJob non lancia mai, cattura ogni errore nel record stesso.
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
   * Deletes a backup: removes the encrypted blob + sidecar from storage, then the DB record.
   *
   * @auth {maintenance:backup_delete}
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

      // Snapshot di sicurezza obbligatorio: se fallisce, il restore non parte — nulla è stato toccato.
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

      // Blocca tutto il traffico non-admin (letture incluse) e invalida le loro sessioni prima
      // di toccare il DB — un restore è già un'azione deliberata, quindi attivazione immediata,
      // non pianificata. Resta ACTIVE anche a restore concluso: un admin deve terminarla
      // esplicitamente dopo aver verificato che tutto funzioni.
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Restore fallito: ${message}` });
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
   */
  getScheduleConfig: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .query(({ ctx }) => getBackupScheduleSettings(ctx.prisma)),

  /**
   * Updates the automatic-backup schedule + retention settings in AppConfig.
   *
   * @auth {maintenance:update}
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
