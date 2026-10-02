/**
 * A revision snapshots the whole layout even when one row cannot be copied as it was loaded.
 *
 * - A row photo whose object is gone from live storage leaves that row without a photo, and the
 *   revision's audit row names it — it no longer fails the revision (manual or automatic). Unless
 *   no photo could be read at all: a storage that serves none is more likely the wrong place
 *   than one that lost everything, so that revision fails and is retried.
 * - Any other copy failure still fails the revision, so it is retried rather than recorded short.
 * - A row deleted while the snapshot is taken does not fail it.
 * - Photos are copied a bounded number at a time, never all at once.
 *
 * Storage is real (local, in a temp dir) where the photo bytes matter.
 */

import { createHash, randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { IMAGE_FETCH_CONCURRENCY } from '../src/lib/export/concurrency';
import { createRevision } from '../src/services/collectionLayoutRevision.service';
import { getStorageProvider, resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let basePath: string;
let session: UserSession;
let adminId: string;
let layoutId: string;
let groupId: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  basePath = await mkdtemp(join(tmpdir(), 'luke-revision-photos-'));
  await seedLocalStorageConfig(prisma, basePath);
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();

  const admin = await createTestUser('admin');
  session = admin.session;
  adminId = admin.user.id;
  const asAdmin = createCallerWithSession(session);
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `RP${uid}`, name: `Photos ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `P${uid}`, name: `Season ${uid}`, year: 2033, isActive: true } }),
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
  layoutId = layout.id;
  groupId = group.id;
});

afterEach(async () => {
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function row(pictureKey: string | null = null): Promise<string> {
  const created = await createCallerWithSession(session).collectionLayout.rows.create({
    groupId,
    gender: 'UOMO',
    line: `Linea ${randomUUID().substring(0, 4)}`,
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: null,
    qtyForecast: null,
  });
  if (pictureKey) await prisma.collectionLayoutRow.update({ where: { id: created.id }, data: { pictureKey } });
  return created.id;
}

/** A photo in the live bucket with its `FileObject`, as an upload leaves it. */
async function livePhoto(): Promise<string> {
  const bytes = createValidPngBuffer();
  const { key } = await (await getStorageProvider(prisma)).put({
    bucket: 'collection-row-pictures',
    originalName: 'row.png',
    contentType: 'image/png',
    size: bytes.byteLength,
    stream: Readable.from(bytes),
  });
  await prisma.fileObject.create({
    data: {
      bucket: 'collection-row-pictures', key, originalName: 'row.png', size: bytes.byteLength,
      contentType: 'image/png', checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      createdBy: adminId, confirmedAt: new Date(),
    },
  });
  return key;
}

const snapshotKeys = async (revisionId: string) =>
  Object.fromEntries(
    (await prisma.collectionLayoutRowRevision.findMany({ where: { revisionId }, select: { sourceRowId: true, pictureKey: true } }))
      .map(r => [r.sourceRowId, r.pictureKey]),
  );

const revisionCount = () => prisma.collectionLayoutRevision.count({ where: { collectionLayoutId: layoutId } });

const input = () => ({ collectionLayoutId: layoutId, revisionTypeValue: 'REVISIONE_PROGETTUALE', cause: 'MANUAL' as const });

describe('a row photo gone from live storage', () => {
  it('leaves that row without a photo, copies the others, and names it in the audit row', async () => {
    const goneKey = await livePhoto();
    const keptKey = await livePhoto();
    const gone = await row(goneKey);
    const kept = await row(keptKey);
    await (await getStorageProvider(prisma)).delete({ bucket: 'collection-row-pictures', key: goneKey });

    const revision = await createCallerWithSession(session).collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'REVISIONE_PROGETTUALE',
    });

    const keys = await snapshotKeys(revision.id);
    expect(keys[gone]).toBeNull();
    expect(await prisma.fileObject.count({
      where: { bucket: 'collection-row-pictures-revisions', key: keys[kept]!, createdBy: 'system' },
    })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COLLECTION_LAYOUT_REVISION_CREATE', targetId: revision.id },
    });
    expect(audit.metadata).toMatchObject({ missingPhotoRowIds: [gone] });
  });

  it('fails the revision when no photo at all could be found: absence is believed only from a storage that served one', async () => {
    const keys = [await livePhoto(), await livePhoto()];
    for (const key of keys) await row(key);
    for (const key of keys) await (await getStorageProvider(prisma)).delete({ bucket: 'collection-row-pictures', key });

    await expect(
      createCallerWithSession(session).collectionLayoutRevision.create({
        collectionLayoutId: layoutId,
        revisionTypeValue: 'REVISIONE_PROGETTUALE',
      }),
    ).rejects.toThrow();
    expect(await revisionCount()).toBe(0);
  });
});

describe('any other copy failure', () => {
  it('stops the copies still queued', async () => {
    for (let i = 0; i < IMAGE_FETCH_CONCURRENCY + 4; i++) await row(`2026/01/01/${i}.png`);
    let calls = 0;

    await expect(createRevision(input(), adminId, async () => {
      if (++calls === 1) throw new Error('connect ECONNREFUSED');
      await new Promise(resolve => setTimeout(resolve, 20));
      return 'copied/x.png';
    }, prisma)).rejects.toThrow('ECONNREFUSED');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(calls).toBe(IMAGE_FETCH_CONCURRENCY);
  });

  it('fails the revision and writes nothing', async () => {
    await row('2026/01/01/a.png');

    await expect(
      createRevision(input(), adminId, async () => {
        throw new Error('connect ECONNREFUSED');
      }, prisma),
    ).rejects.toThrow('ECONNREFUSED');
    expect(await revisionCount()).toBe(0);
  });
});

describe('a row deleted while the snapshot is taken', () => {
  it('does not fail the revision', async () => {
    await row('2026/01/01/a.png');
    const doomed = await row();

    await createRevision(input(), adminId, async () => {
      // Between the layout load and the snapshot transaction.
      await prisma.collectionLayoutRow.delete({ where: { id: doomed } });
      return 'copied/a.png';
    }, prisma);

    expect(await revisionCount()).toBe(1);
  });
});

describe('photo copies', () => {
  it(`run at most ${IMAGE_FETCH_CONCURRENCY} at a time`, async () => {
    for (let i = 0; i < IMAGE_FETCH_CONCURRENCY + 4; i++) await row(`2026/01/01/${i}.png`);
    let inFlight = 0;
    let peak = 0;

    await createRevision(input(), adminId, async key => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight -= 1;
      return `copied/${key}`;
    }, prisma);

    expect(peak).toBe(IMAGE_FETCH_CONCURRENCY);
  });
});
