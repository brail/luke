/**
 * Age-based retention sweep for `AuditLog` and `Notification`/`NotificationDedupKey` — none of
 * these tables had a purge mechanism before this, so they grew unbounded (see
 * `docs/decisions/` for the AppConfig-driven pattern this mirrors from `backupScheduler.ts`).
 *
 * Daily tick, single lock (`retention-sweep`) shared by all three sweeps below — unlike
 * `backupScheduler.ts`, none of these need per-row side effects or a keep-N-most-recent floor, so
 * they share the same bounded "collect ids up to a cap → act → delete" shape via
 * `retentionSweep.ts` instead of `backupScheduler.ts`'s per-row prune loop.
 *
 * `sweepAuditLog` archives before deleting (`auditLogArchive.ts`) — audit history has compliance
 * value. `sweepNotifications`/`sweepDedupKeys` delete outright — read notifications and expired
 * dedup markers have none once past their window.
 */

import { randomUUID } from 'crypto';

import { getStorageProvider } from '../storage';

import { CRITICAL_AUDIT_ACTIONS } from './auditLog';
import { archiveAuditLogRows } from './auditLogArchive';
import {
  getAuditLogCriticalRetentionDays,
  getAuditLogRetentionDays,
  getNotificationDedupRetentionDays,
  getNotificationRetentionDays,
} from './configManager';
import { collectIdsOlderThan, deleteIdsInBatches } from './retentionSweep';
import { withSchedulerLock } from './schedulerLock';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Hard cap on rows processed per tier per tick — bounds one tick's work; the remainder is picked up on the next tick. */
const MAX_ROWS_PER_TICK = 20000;

function cutoffDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Archives then deletes expired `AuditLog` rows, one tier at a time. A failed archive upload
 * aborts that tier only — its rows are left untouched for the next tick, while the other tier
 * still proceeds. The two tiers touch disjoint id sets and already isolate their own errors, so
 * they run concurrently rather than paying their latency twice.
 */
async function sweepAuditLog(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  tickId: string,
  retentionDays: number,
  criticalRetentionDays: number,
): Promise<void> {
  const criticalActions = [...CRITICAL_AUDIT_ACTIONS];

  const tiers: { tier: 'normal' | 'critical'; where: Prisma.AuditLogWhereInput }[] = [
    { tier: 'normal', where: { createdAt: { lt: cutoffDaysAgo(retentionDays) }, action: { notIn: criticalActions } } },
    { tier: 'critical', where: { createdAt: { lt: cutoffDaysAgo(criticalRetentionDays) }, action: { in: criticalActions } } },
  ];

  // Fetched once and shared: `getStorageProvider` memoizes a module-level singleton, and both
  // tiers write to the same bucket — no reason to re-resolve it per tier.
  const provider = await getStorageProvider(prisma);

  await Promise.all(tiers.map(async ({ tier, where }) => {
    const ids = await collectIdsOlderThan(
      (skip, take) => prisma.auditLog.findMany({ where, select: { id: true }, skip, take, orderBy: { createdAt: 'asc' } }),
      MAX_ROWS_PER_TICK,
    );
    if (ids.length === 0) return;

    try {
      const { key } = await archiveAuditLogRows(provider, prisma, ids, tickId, tier);
      const deleted = await deleteIdsInBatches(
        chunk => prisma.auditLog.deleteMany({ where: { id: { in: chunk } } }).then(r => r.count),
        ids,
      );
      log.info({ tier, deleted, archiveKey: key }, 'Retention sweep: audit log archiviato e rimosso');
    } catch (err) {
      log.error({ err, tier, candidateRows: ids.length }, 'Retention sweep: archiviazione audit log fallita, righe conservate per il prossimo tick');
    }
  }));
}

/** Deletes read notifications past their retention window. Unread notifications are never swept. */
async function sweepNotifications(prisma: PrismaClient, log: FastifyInstance['log'], retentionDays: number): Promise<void> {
  const cutoff = cutoffDaysAgo(retentionDays);

  const ids = await collectIdsOlderThan(
    (skip, take) => prisma.notification.findMany({
      where: { isRead: true, readAt: { lt: cutoff } },
      select: { id: true },
      skip,
      take,
      orderBy: { readAt: 'asc' },
    }),
    MAX_ROWS_PER_TICK,
  );
  if (ids.length === 0) return;

  const deleted = await deleteIdsInBatches(
    chunk => prisma.notification.deleteMany({ where: { id: { in: chunk } } }).then(r => r.count),
    ids,
  );
  log.info({ deleted }, 'Retention sweep: notifiche lette rimosse');
}

/** Deletes expired dedup markers. Table is small/bounded by stable keys — no batching needed. */
async function sweepDedupKeys(prisma: PrismaClient, log: FastifyInstance['log'], dedupRetentionDays: number): Promise<void> {
  const { count } = await prisma.notificationDedupKey.deleteMany({
    where: { lastSentAt: { lt: cutoffDaysAgo(dedupRetentionDays) } },
  });
  if (count > 0) log.info({ deleted: count }, 'Retention sweep: dedup key notifiche rimosse');
}

async function runTick(prisma: PrismaClient, log: FastifyInstance['log']): Promise<void> {
  const tickId = randomUUID();

  // Le 4 finestre di retention sono indipendenti fra loro (stesso pattern di
  // `getBackupScheduleSettings`) — un solo giro di round trip invece di uno per sweep.
  const [retentionDays, criticalRetentionDays, notificationRetentionDays, dedupRetentionDays] = await Promise.all([
    getAuditLogRetentionDays(prisma),
    getAuditLogCriticalRetentionDays(prisma),
    getNotificationRetentionDays(prisma),
    getNotificationDedupRetentionDays(prisma),
  ]);

  // Le tre tabelle sono disgiunte e ognuna isola già i propri errori (sweepAuditLog per tier,
  // le altre due tramite `allSettled` qui) — nessuna ragione di pagarne la latenza in sequenza,
  // né di far saltare gli sweep successivi se uno dei tre fallisce.
  const results = await Promise.allSettled([
    sweepAuditLog(prisma, log, tickId, retentionDays, criticalRetentionDays),
    sweepNotifications(prisma, log, notificationRetentionDays),
    sweepDedupKeys(prisma, log, dedupRetentionDays),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ err: result.reason }, 'Retention sweep: uno sweep è fallito, gli altri sono comunque andati avanti');
    }
  }
}

/**
 * Registers the retention scheduler as a Fastify plugin (`onReady`/`onClose`), same pattern as
 * the other tick-based schedulers (`backupScheduler`, `calendarDigestScheduler`, ...).
 */
export function registerRetentionScheduler(fastify: FastifyInstance, prisma: PrismaClient): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const lockedTick = withSchedulerLock(prisma, 'retention-sweep', () => runTick(prisma, fastify.log));
  const run = () =>
    lockedTick().catch(err =>
      fastify.log.error({ err }, 'Retention sweep: errore non gestito')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Retention sweep: avviato (tick ogni 24h, audit log + notifiche + dedup key)');
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Retention sweep: fermato');
  });
}
