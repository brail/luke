/**
 * One-shot repair of the photos of automatic Collection Layout revisions.
 *
 * Until 2026-09-26 automatic (MILESTONE) revisions stored the live `collection-row-pictures` key
 * instead of copying the photo into the immutable `collection-row-pictures-revisions` bucket, where
 * every revision reader looks. This repair copies each photo that is still in live storage and
 * points the revision rows at the copy — the one traced exception to the revision snapshots being
 * immutable. Run by `scripts/repair-auto-revision-photos.ts`.
 *
 * Nothing is inferred from a missing record or a failed read alone: a key is "not recoverable"
 * only when no `FileObject` names it and a listing of the live bucket confirms the object is gone;
 * any other doubt is an error, reported and left unwritten.
 */

import { createHash } from 'crypto';

import type { StorageBucket } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { copyToImmutableBucket, getStorageProvider, readObjectBuffer } from '../storage/index.js';

const LIVE: StorageBucket = 'collection-row-pictures';
const IMMUTABLE: StorageBucket = 'collection-row-pictures-revisions';

export const PHOTO_REPAIR_AUDIT_ACTION = 'COLLECTION_LAYOUT_REVISION_PHOTO_REPAIR';

export type KeyOutcome =
  | { key: string; outcome: 'immutable' }
  | { key: string; outcome: 'repairable' | 'repaired'; newKey?: string; revisionIds: string[] }
  | { key: string; outcome: 'not-recoverable'; revisionIds: string[] }
  | { key: string; outcome: 'error'; reason: string; revisionIds: string[] };

export interface PhotoRepairReport {
  runId: string;
  apply: boolean;
  keys: KeyOutcome[];
}

type Provider = Awaited<ReturnType<typeof getStorageProvider>>;

const LIST_LIMIT = 1000;

/**
 * Whether `key` is listed in `bucket`. Absence must be established, so a listing that may be
 * incomplete throws instead of answering false: the local provider stops scanning at `limit`
 * before sorting and may return no cursor, so a full page proves nothing either way.
 */
async function isListed(provider: Provider, bucket: StorageBucket, key: string): Promise<boolean> {
  // ponytail: one listing per key (the local provider scans the bucket); fine for a one-shot run.
  const { items, nextCursor } = await provider.list({ bucket, prefix: key, limit: LIST_LIMIT });
  if (items.some(item => item.key === key)) return true;
  if (nextCursor || items.length >= LIST_LIMIT) {
    throw new Error(`listing of ${bucket} under ${key} may be incomplete`);
  }
  return false;
}

/**
 * Classifies every photo key of automatic revisions and, with `apply`, repairs the recoverable
 * ones: the copy is made first, then the row update and one audit row per revision and key are
 * written in a single transaction, so a failure leaves the key to be repaired again, never
 * repaired untraced.
 */
export async function repairAutoRevisionPhotos(
  prisma: PrismaClient,
  { apply, runId }: { apply: boolean; runId: string },
): Promise<PhotoRepairReport> {
  // `sourceRowId` and `milestoneId` are soft FKs: select through the revision only.
  const rows = await prisma.collectionLayoutRowRevision.findMany({
    where: { pictureKey: { not: null }, revision: { cause: 'MILESTONE' } },
    select: { id: true, revisionId: true, pictureKey: true },
  });

  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.pictureKey!;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const provider = await getStorageProvider(prisma);
  const keys: KeyOutcome[] = [];

  for (const [key, keyRows] of byKey) {
    const revisionIds = [...new Set(keyRows.map(r => r.revisionId))];
    try {
      const [immutableRecord, liveRecord] = await Promise.all([
        prisma.fileObject.findFirst({ where: { bucket: IMMUTABLE, key }, select: { id: true } }),
        prisma.fileObject.findFirst({ where: { bucket: LIVE, key }, select: { checksumSha256: true } }),
      ]);

      if (immutableRecord) {
        keys.push(
          (await isListed(provider, IMMUTABLE, key))
            ? { key, outcome: 'immutable' }
            : { key, outcome: 'error', reason: 'revisions-bucket record without its object', revisionIds },
        );
        continue;
      }

      if (!(await isListed(provider, LIVE, key))) {
        keys.push(
          liveRecord
            ? { key, outcome: 'error', reason: 'live record without its object', revisionIds }
            : { key, outcome: 'not-recoverable', revisionIds },
        );
        continue;
      }

      const bytes = await readObjectBuffer(prisma, LIVE, key);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (liveRecord && liveRecord.checksumSha256 !== checksum) {
        keys.push({ key, outcome: 'error', reason: 'live object does not match its checksum', revisionIds });
        continue;
      }

      if (!apply) {
        keys.push({ key, outcome: 'repairable', revisionIds });
        continue;
      }

      const newKey = await copyToImmutableBucket(prisma, key);
      // The copier's SHA-256 dedup only checks the database.
      if (!(await isListed(provider, IMMUTABLE, newKey))) {
        keys.push({ key, outcome: 'error', reason: `copy ${newKey} is not in the revisions bucket`, revisionIds });
        continue;
      }

      await prisma.$transaction(async tx => {
        // Only rows still on the old key: a concurrent run that got there first leaves fewer, and
        // the whole key is rolled back rather than audited as a transition that did not happen.
        const { count } = await tx.collectionLayoutRowRevision.updateMany({
          where: { id: { in: keyRows.map(r => r.id) }, pictureKey: key },
          data: { pictureKey: newKey },
        });
        if (count !== keyRows.length) {
          throw new Error(`conflict: ${keyRows.length - count} row(s) changed by a concurrent run`);
        }
        await tx.auditLog.createMany({
          data: revisionIds.map(revisionId => ({
            actorId: null,
            action: PHOTO_REPAIR_AUDIT_ACTION,
            targetType: 'CollectionLayoutRevision',
            targetId: revisionId,
            result: 'SUCCESS',
            metadata: {
              runId,
              reason: 'auto-revision-live-key',
              rowRevisionIds: keyRows.filter(r => r.revisionId === revisionId).map(r => r.id),
              oldKey: key,
              newKey,
              checksumSha256: checksum,
            },
          })),
        });
      });
      keys.push({ key, outcome: 'repaired', newKey, revisionIds });
    } catch (err) {
      keys.push({ key, outcome: 'error', reason: err instanceof Error ? err.message : String(err), revisionIds });
    }
  }

  return { runId, apply, keys };
}
