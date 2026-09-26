/**
 * The one-shot repair of automatic revision photos (`autoRevisionPhotoRepair.service.ts`).
 *
 * The legacy data is produced the way it was in production: `createRevision` with the identity
 * copier automatic revisions used until 2026-09-26, so the row snapshots hold live
 * `collection-row-pictures` keys. Storage is real (local, in a temp dir).
 */

import { createHash, randomUUID } from 'crypto';
import { chmod, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import {
  PHOTO_REPAIR_AUDIT_ACTION,
  repairAutoRevisionPhotos,
} from '../src/services/autoRevisionPhotoRepair.service';
import { createRevision } from '../src/services/collectionLayoutRevision.service';
import * as storage from '../src/storage';
import { getStorageProvider, resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

let prisma: PrismaClient;
let basePath: string;
let adminId: string;
let layoutId: string;
let rowId: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  basePath = await mkdtemp(join(tmpdir(), 'luke-photo-repair-'));
  await seedLocalStorageConfig(prisma, basePath);
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();

  const admin = await createTestUser('admin');
  adminId = admin.user.id;
  const asAdmin = createCallerWithSession(admin.session);
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `PR${uid}`, name: `Repair ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `R${uid}`, name: `Season ${uid}`, year: 2033, isActive: true } }),
  ]);
  const layout = await asAdmin.collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['UOMO'],
  });
  const group = await asAdmin.collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Gruppo', order: 0 },
  });
  const row = await asAdmin.collectionLayout.rows.create({
    groupId: group.id,
    gender: 'UOMO',
    line: 'Linea',
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: null,
    qtyForecast: null,
  });
  layoutId = layout.id;
  rowId = row.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A photo in the live bucket with its `FileObject`, as an upload leaves it. */
async function livePhoto(): Promise<string> {
  const bytes = createValidPngBuffer();
  const provider = await getStorageProvider(prisma);
  const { key } = await provider.put({
    bucket: 'collection-row-pictures',
    originalName: 'row.png',
    contentType: 'image/png',
    size: bytes.byteLength,
    stream: Readable.from(bytes),
  });
  await prisma.fileObject.create({
    data: {
      bucket: 'collection-row-pictures',
      key,
      originalName: 'row.png',
      size: bytes.byteLength,
      contentType: 'image/png',
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      createdBy: adminId,
      confirmedAt: new Date(),
    },
  });
  return key;
}

/** An automatic revision snapshotted the pre-fix way: the row keeps its live key. */
async function legacyAutoRevision(pictureKey: string) {
  await prisma.collectionLayoutRow.update({ where: { id: rowId }, data: { pictureKey } });
  const revision = await createRevision(
    {
      collectionLayoutId: layoutId,
      revisionTypeValue: 'MILESTONE_DATA',
      cause: 'MILESTONE',
      milestoneId: randomUUID(),
      notes: 'legacy',
    },
    adminId,
    async key => key,
    prisma,
  );
  return revision.id;
}

async function rowKeys(revisionId: string) {
  const rows = await prisma.collectionLayoutRowRevision.findMany({ where: { revisionId }, select: { pictureKey: true } });
  return rows.map(r => r.pictureKey);
}

const auditRows = () => prisma.auditLog.findMany({ where: { action: PHOTO_REPAIR_AUDIT_ACTION } });

describe('repairAutoRevisionPhotos', () => {
  it('a dry run classifies and writes nothing', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);

    const report = await repairAutoRevisionPhotos(prisma, { apply: false, runId: 'dry' });

    expect(report.keys).toEqual([{ key, outcome: 'repairable', revisionIds: [revisionId] }]);
    expect(await rowKeys(revisionId)).toEqual([key]);
    expect(await auditRows()).toHaveLength(0);
    expect(await prisma.fileObject.count({ where: { bucket: 'collection-row-pictures-revisions' } })).toBe(0);
  });

  it('copies a key shared by two revisions once, repoints both, audits each, and a rerun is a no-op', async () => {
    const key = await livePhoto();
    const first = await legacyAutoRevision(key);
    const second = await legacyAutoRevision(key);

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run-1' });

    const outcome = report.keys[0];
    expect(outcome).toMatchObject({ key, outcome: 'repaired' });
    const newKey = outcome && 'newKey' in outcome ? outcome.newKey : undefined;
    expect(newKey).toBeTruthy();
    expect(await rowKeys(first)).toEqual([newKey]);
    expect(await rowKeys(second)).toEqual([newKey]);
    expect(await prisma.fileObject.count({ where: { bucket: 'collection-row-pictures-revisions', key: newKey } })).toBe(1);
    const audits = await auditRows();
    expect(audits.map(a => a.targetId).sort()).toEqual([first, second].sort());
    expect(audits[0]?.metadata).toMatchObject({ runId: 'run-1', oldKey: key, newKey });

    const rerun = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run-2' });
    expect(rerun.keys).toEqual([{ key: newKey, outcome: 'immutable' }]);
    expect(await auditRows()).toHaveLength(2);
  });

  it('a photo gone from storage, with no record, is not recoverable and left as it is', async () => {
    const revisionId = await legacyAutoRevision('2026/01/gone.png');

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run' });

    expect(report.keys).toEqual([{ key: '2026/01/gone.png', outcome: 'not-recoverable', revisionIds: [revisionId] }]);
    expect(await rowKeys(revisionId)).toEqual(['2026/01/gone.png']);
  });

  it('an unreadable live photo is an error, not a loss, and nothing is written', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);
    await chmod(join(basePath, 'collection-row-pictures', key), 0o000);

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run' });

    expect(report.keys[0]).toMatchObject({ key, outcome: 'error' });
    expect(await rowKeys(revisionId)).toEqual([key]);
    expect(await auditRows()).toHaveLength(0);
    await chmod(join(basePath, 'collection-row-pictures', key), 0o644);
  });

  it('a failed audit rolls the row update back, and the next run repairs the key', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);
    const realTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (fn: (tx: unknown) => Promise<unknown>) =>
      realTransaction(async tx =>
        fn(new Proxy(tx, {
          get: (target, prop) =>
            prop === 'auditLog'
              ? { createMany: async () => { throw new Error('audit unavailable'); } }
              : Reflect.get(target, prop),
        })),
      )) as never);

    const failed = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run-1' });
    expect(failed.keys[0]).toMatchObject({ key, outcome: 'error', reason: 'audit unavailable' });
    expect(await rowKeys(revisionId)).toEqual([key]);

    const retried = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run-2' });
    expect(retried.keys[0]).toMatchObject({ key, outcome: 'repaired' });
    expect(await auditRows()).toHaveLength(1);
  });

  it('a run overlapped by another one reports a conflict and audits nothing of its own', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);
    const realCopy = storage.copyToImmutableBucket;
    // The other run starts and finishes between this run's classification and its transaction.
    vi.spyOn(storage, 'copyToImmutableBucket').mockImplementationOnce(async (client, sourceKey) => {
      await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'other' });
      return realCopy(client, sourceKey);
    });

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'this' });

    expect(report.keys[0]).toMatchObject({ key, outcome: 'error', reason: expect.stringMatching(/^conflict/) });
    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ runId: 'other' });
    expect(await rowKeys(revisionId)).not.toEqual([key]);
  });

  it.each([
    ['a full page with no cursor (the local provider)', { items: Array.from({ length: 1000 }, (_, i) => ({ key: `2026/01/gone.png.${i}`, size: 1, modifiedAt: new Date() })) }],
    ['a page with a cursor', { items: [], nextCursor: 'more' }],
  ])('an absence the listing cannot prove is an error, not a loss: %s', async (_label, page) => {
    const revisionId = await legacyAutoRevision('2026/01/gone.png');
    const provider = await getStorageProvider(prisma);
    vi.spyOn(provider, 'list').mockResolvedValue(page);

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run' });

    expect(report.keys).toEqual([
      expect.objectContaining({ key: '2026/01/gone.png', outcome: 'error', revisionIds: [revisionId] }),
    ]);
  });

  it('a live object that does not match its checksum is an error and nothing is written', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);
    await prisma.fileObject.updateMany({ where: { bucket: 'collection-row-pictures', key }, data: { checksumSha256: 'deadbeef' } });

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run' });

    expect(report.keys[0]).toMatchObject({ key, outcome: 'error', reason: 'live object does not match its checksum' });
    expect(await rowKeys(revisionId)).toEqual([key]);
  });

  it('a deduplicated copy whose object is missing is an error and nothing is written', async () => {
    const key = await livePhoto();
    const revisionId = await legacyAutoRevision(key);
    const live = await prisma.fileObject.findFirstOrThrow({ where: { bucket: 'collection-row-pictures', key } });
    // A revisions-bucket record with the same checksum and no object: the copier's dedup returns it.
    await prisma.fileObject.create({
      data: { ...live, id: randomUUID(), bucket: 'collection-row-pictures-revisions', key: 'ghost/copy.png' },
    });

    const report = await repairAutoRevisionPhotos(prisma, { apply: true, runId: 'run' });

    expect(report.keys[0]).toMatchObject({ key, outcome: 'error', reason: expect.stringContaining('ghost/copy.png') });
    expect(await rowKeys(revisionId)).toEqual([key]);
    expect(await auditRows()).toHaveLength(0);
  });
});
