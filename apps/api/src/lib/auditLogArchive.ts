/**
 * Compresses expired audit log rows into a single NDJSON.gz file in the private `backups` bucket
 * before `retentionScheduler.ts` deletes them — audit history has compliance value, so retention
 * archives it instead of discarding it outright (unlike `Notification`, which is pure UX state).
 *
 * Streaming idiom mirrors `generateAuditLogCsv` in `routes/auditLogExportDownload.ts` (async
 * generator → `Readable.from` → piped stream), and reuses `createGzip` the same way
 * `backup/dumpPipeline.ts` does for its own blob upload. One file per (tick, tier) rather than
 * one per delete batch, so a busy tick doesn't scatter dozens of small archive files.
 */

import { Readable } from 'stream';
import { createGzip } from 'zlib';

import type { IStorageProvider } from '@luke/core';

import { BATCH_SIZE } from './retentionSweep';

import type { PrismaClient } from '@prisma/client';

/** Storage key for one tick's archive of a given retention tier — the writer (here) and the deleter (`retentionScheduler.ts`) must agree only on ordering (archive before delete), not on this key. */
export function auditLogArchiveKey(tickId: string, tier: 'normal' | 'critical'): string {
  const year = new Date().getUTCFullYear();
  return `audit-archive/${year}/${tickId}-${tier}.ndjson.gz`;
}

async function* generateAuditLogNdjson(prisma: PrismaClient, ids: string[]) {
  // Reuses `retentionSweep.ts`'s own batch size instead of a third, independent constant —
  // `ids` is already capped at `MAX_ROWS_PER_TICK` by the caller, this only bounds memory
  // per `findMany` round trip.
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const rows = await prisma.auditLog.findMany({ where: { id: { in: chunk } } });
    for (const row of rows) {
      yield `${JSON.stringify(row)}\n`;
    }
  }
}

/**
 * Archives the audit log rows identified by `ids` as one gzip-compressed NDJSON file.
 *
 * Durability contract: the caller (`retentionScheduler.ts`) must only delete these rows once this
 * resolves successfully — a failed/rejected upload must leave the rows untouched so the next
 * tick retries the same rows rather than losing them.
 */
export async function archiveAuditLogRows(
  provider: IStorageProvider,
  prisma: PrismaClient,
  ids: string[],
  tickId: string,
  tier: 'normal' | 'critical',
): Promise<{ key: string }> {
  const key = auditLogArchiveKey(tickId, tier);
  const gzip = createGzip();
  Readable.from(generateAuditLogNdjson(prisma, ids)).pipe(gzip);

  await provider.put({
    bucket: 'backups',
    key,
    originalName: key,
    contentType: 'application/gzip',
    size: 0, // unknown ahead of time — put() doesn't rely on this for correctness (same as dumpPipeline.ts)
    stream: gzip,
    bypassSizeLimit: true, // internal privileged write, not a user upload — same as the backup engine's own blob
  });

  return { key };
}
