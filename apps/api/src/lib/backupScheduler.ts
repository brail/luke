/**
 * Automatic backup scheduling + retention pruning.
 *
 * Hourly tick. Once `backup.schedule.enabled` is on and the current hour matches
 * `backup.schedule.dailyTime`, kicks off a `trigger=SCHEDULED` backup — same engine
 * (`runBackupJob`) as a manual create, just with no `createdById`. At most once per day
 * (in-memory guard, same pattern as `calendarDigestScheduler`).
 *
 * Every tick — independently of whether scheduling is enabled — also:
 * - Reaps backups stuck in `RUNNING`/`PENDING` (the process that ran them crashed mid-job):
 *   marks them `FAILED` after `STUCK_JOB_THRESHOLD_MS` with no progress, so they don't linger
 *   forever and are picked up by the pruning pass below on a later tick.
 * - Prunes retention: deletes `COMPLETED` backups (blob + sidecar + record) past their
 *   `expiresAt`, always keeping at least `backup.retentionMinCount` of the most recent ones —
 *   the one category with genuine safety-net value, hence the floor. `FAILED` backups past
 *   their `expiresAt` are deleted too, but with no floor: a failed attempt has no recovery
 *   value once expired, so there's nothing worth keeping N of. `PRE_RESTORE_SAFETY` snapshots
 *   are never swept here — see `createPendingBackupRecord` in dumpPipeline.ts, their `expiresAt`
 *   is always `null`.
 */

import { getStorageProvider } from '../storage';

import { createPendingBackupRecord, deleteBackupBlob, runBackupJob } from './backup/dumpPipeline';
import { getBackupScheduleSettings } from './configManager';
import { notifyAdmins, notifyDeduped, SYSTEM_FAILURE_DEDUP_MS } from './notifications';

import type { BackupScope, BackupStatus, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

/** How long a backup can sit in RUNNING/PENDING before it's considered abandoned. */
const STUCK_JOB_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/** Hour component of a validated "HH:mm" string — `getBackupScheduleSettings` guarantees the format. */
function hourOf(dailyTime: string): number {
  return parseInt(dailyTime.slice(0, 2), 10);
}

async function runScheduledBackup(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  scope: BackupScope,
  notifyOnFailure: boolean,
): Promise<void> {
  const record = await createPendingBackupRecord(prisma, { scope, trigger: 'SCHEDULED' });
  log.info({ backupId: record.id, scope }, 'Backup scheduler: avvio backup pianificato');

  await runBackupJob({ prisma, backupId: record.id, scope, logger: log });

  const result = await prisma.backupRecord.findUnique({
    where: { id: record.id },
    select: { status: true, errorMessage: true },
  });
  if (result?.status === 'COMPLETED' || !notifyOnFailure) return;

  await notifyDeduped('backup-schedule:failure', SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(prisma, {
    category: 'SYSTEM',
    title: 'Backup pianificato fallito',
    message: result?.errorMessage ?? 'Errore sconosciuto',
    data: { type: 'backup_schedule_failure', backupId: record.id },
  })).catch(e => log.error({ err: e }, 'Failed to notify admins of scheduled backup failure'));
}

/** Marks backups abandoned in RUNNING/PENDING as FAILED, so a crashed job doesn't linger forever. */
async function reapStuckBackups(prisma: PrismaClient, log: FastifyInstance['log']): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS);
  const { count } = await prisma.backupRecord.updateMany({
    where: { status: { in: ['RUNNING', 'PENDING'] }, startedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      errorMessage: 'Job abbandonato: nessun aggiornamento di stato da oltre 2 ore (processo probabilmente terminato in modo anomalo)',
    },
  });
  if (count > 0) log.warn({ count }, 'Backup retention: job bloccati contrassegnati come falliti');
}

/**
 * Retention floor per terminal `BackupStatus` — how many of the most recent expired-eligible
 * backups of that status to always keep; `null` means the status isn't eligible for this
 * expiry-based pruning at all. `PENDING`/`RUNNING` are transient, not terminal — `reapStuckBackups`
 * handles those. A `Record` over the *full* enum, not just the statuses handled today, so a future
 * `BackupStatus` addition fails to typecheck here until it's given an explicit floor — it can't
 * silently fall through unreaped.
 */
function retentionFloorByStatus(retentionMinCount: number): Record<BackupStatus, number | null> {
  return {
    PENDING: null,
    RUNNING: null,
    COMPLETED: retentionMinCount, // the only category with genuine safety-net value
    FAILED: 0, // nothing worth keeping N of once expired
  };
}

/**
 * Deletes backups past their `expiresAt`, per-status floor from `retentionFloorByStatus`. Blob+
 * sidecar deletion is skipped for records with no `filename` (FAILED ones never reach COMPLETED,
 * so nothing was ever uploaded).
 */
async function pruneExpiredBackups(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  retentionMinCount: number,
): Promise<void> {
  const floors = retentionFloorByStatus(retentionMinCount);
  const eligibleStatuses = (Object.keys(floors) as BackupStatus[]).filter(status => floors[status] !== null);

  const expiredByStatus = await Promise.all(
    eligibleStatuses.map(status =>
      prisma.backupRecord.findMany({
        where: { status, expiresAt: { lt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, filename: true },
        skip: floors[status]!,
      })
    )
  );

  const toDelete = expiredByStatus.flat();
  if (toDelete.length === 0) return;

  const provider = await getStorageProvider(prisma);
  const results = await Promise.allSettled(toDelete.map(async backup => {
    // Storage delete failures abort this one record (not caught here) — the row survives
    // for a retry next tick, rather than silently orphaning its blob in storage forever.
    if (backup.filename) await deleteBackupBlob(provider, backup.id);
    await prisma.backupRecord.delete({ where: { id: backup.id } });
  }));

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      log.error({ err: result.reason, backupId: toDelete[i].id }, 'Backup retention: pruning fallito per questo backup');
    }
  });
  const deleted = results.filter(r => r.status === 'fulfilled').length;
  log.info({ deleted, retentionMinCount }, 'Backup retention: pruning completato');
}

async function runTick(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  state: { lastRunDate: string | null },
): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const config = await getBackupScheduleSettings(prisma);

  if (config.enabled && state.lastRunDate !== today && now.getHours() === hourOf(config.dailyTime)) {
    state.lastRunDate = today;
    await runScheduledBackup(prisma, log, config.scope, config.notifyOnFailure);
  }
  await reapStuckBackups(prisma, log);
  await pruneExpiredBackups(prisma, log, config.retentionMinCount);
}

/**
 * Registers the backup scheduler as a Fastify plugin (`onReady`/`onClose`), same pattern as
 * the other tick-based schedulers (`calendarDigestScheduler`, `milestoneDeadlineScheduler`, ...).
 */
export function registerBackupScheduler(fastify: FastifyInstance, prisma: PrismaClient): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const state = { lastRunDate: null as string | null };

  const run = () =>
    runTick(prisma, fastify.log, state).catch(err =>
      fastify.log.error({ err }, 'Backup scheduler: errore non gestito')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Backup scheduler: avviato (tick ogni ora, backup pianificato + retention pruning)');
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Backup scheduler: fermato');
  });
}
