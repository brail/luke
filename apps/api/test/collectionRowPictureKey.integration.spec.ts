/**
 * A row's picture key is chosen by the server, never by the client: it comes only from a confirmed
 * pending upload, a replace or a removal deletes only the row's own stored key, and an unusable
 * pending file refuses the save. Confirming a pending file is an atomic claim, so a file is linked
 * at most once, also under concurrent saves.
 */

import { createHash, randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS, type StorageBucket } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { confirmPendingFile } from '../src/lib/pendingFile';
import { getStorageProvider, resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let basePath: string;
let session: UserSession;
let userId: string;
let otherUserId: string;
let groupId: string;
let otherGroupId: string;

const caller = () => createCallerWithSession(session);

type RowCreateInput = Parameters<ReturnType<typeof caller>['collectionLayout']['rows']['create']>[0];
type RowUpdateData = Parameters<ReturnType<typeof caller>['collectionLayout']['rows']['update']>[0]['data'];
/** A forged request: the input no longer declares `pictureKey`, so the typed caller would refuse it. */
const forged = <T>(value: unknown) => value as T;

beforeAll(async () => {
  prisma = await setupTestDb();
  basePath = await mkdtemp(join(tmpdir(), 'luke-row-picture-key-'));
  await seedLocalStorageConfig(prisma, basePath);
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();

  const [admin, other] = await Promise.all([createTestUser('admin'), createTestUser('editor')]);
  session = admin.session;
  userId = admin.user.id;
  otherUserId = other.user.id;

  const uid = randomUUID().substring(0, 6).toUpperCase();
  const layoutGroup = async (suffix: string) => {
    const [brand, season] = await Promise.all([
      prisma.brand.create({ data: { code: `PK${suffix}${uid}`, name: `Picture ${suffix} ${uid}`, isActive: true } }),
      prisma.season.create({ data: { code: `K${suffix}${uid}`, name: `Season ${suffix} ${uid}`, year: 2033, isActive: true } }),
    ]);
    const layout = await caller().collectionLayout.getOrCreate({ brandId: brand.id, seasonId: season.id, availableGenders: ['MAN'] });
    const group = await caller().collectionLayout.groups.create({ collectionLayoutId: layout.id, data: { name: 'Gruppo', order: 0 } });
    return group.id;
  };
  [groupId, otherGroupId] = await Promise.all([layoutGroup('A'), layoutGroup('B')]);
});

afterAll(async () => {
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const baseRow = (group = groupId) => ({
  groupId: group,
  gender: 'MAN' as const,
  line: `Linea ${randomUUID().substring(0, 6)}`,
  status: COLLECTION_STATUS[0],
  productCategory: 'TEST',
  skuForecast: null,
  qtyForecast: null,
});

/** An uploaded picture with its `FileObject`, pending unless `confirmed`, as the upload route leaves it. */
async function picture(opts: { createdBy?: string; bucket?: StorageBucket; confirmed?: boolean } = {}) {
  const bucket = opts.bucket ?? 'collection-row-pictures';
  const bytes = createValidPngBuffer();
  const { key } = await (await getStorageProvider(prisma)).put({
    bucket, originalName: 'row.png', contentType: 'image/png', size: bytes.byteLength, stream: Readable.from(bytes),
  });
  const file = await prisma.fileObject.create({
    data: {
      bucket, key, originalName: 'row.png', size: bytes.byteLength, contentType: 'image/png',
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      createdBy: opts.createdBy ?? userId, confirmedAt: opts.confirmed ? new Date() : null,
    },
  });
  return { id: file.id, key };
}

const fileExists = async (key: string) => (await prisma.fileObject.count({ where: { key } })) > 0;
const storedKey = async (rowId: string) =>
  (await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: rowId }, select: { pictureKey: true } })).pictureKey;

/** A row holding a picture of its own, linked the only supported way: a confirmed upload. */
async function rowWithPicture(group = groupId) {
  const own = await picture();
  const row = await caller().collectionLayout.rows.create({ ...baseRow(group), pendingPictureFileObjectId: own.id });
  return { rowId: row.id, key: own.key };
}

describe('the client never chooses a row picture key', () => {
  it('drops a key sent on create and on update', async () => {
    const victim = await rowWithPicture(otherGroupId);

    const created = await caller().collectionLayout.rows.create(forged<RowCreateInput>({ ...baseRow(), pictureKey: victim.key }));
    expect(await storedKey(created.id)).toBeNull();

    await caller().collectionLayout.rows.update({ rowId: created.id, data: forged<RowUpdateData>({ pictureKey: victim.key }) });
    expect(await storedKey(created.id)).toBeNull();
  });

  it('a key sent by the client never becomes the row\'s, nor the one a replace deletes', async () => {
    const victim = await rowWithPicture(otherGroupId);
    const own = await caller().collectionLayout.rows.create(baseRow());
    await caller().collectionLayout.rows.update({ rowId: own.id, data: forged<RowUpdateData>({ pictureKey: victim.key }) });

    const upload = await picture();
    await caller().collectionLayout.rows.update({ rowId: own.id, data: { pendingPictureFileObjectId: upload.id } });

    expect(await fileExists(victim.key)).toBe(true);
    expect(await storedKey(victim.rowId)).toBe(victim.key);
    expect(await storedKey(own.id)).toBe(upload.key);
  });

  it('a replace never deletes a key another row still holds', async () => {
    const victim = await rowWithPicture(otherGroupId);
    const own = await caller().collectionLayout.rows.create(baseRow());
    // Two rows on one key: only a direct write produces it now.
    await prisma.collectionLayoutRow.update({ where: { id: own.id }, data: { pictureKey: victim.key } });

    await caller().collectionLayout.rows.update({ rowId: own.id, data: { pendingPictureFileObjectId: (await picture()).id } });

    expect(await fileExists(victim.key)).toBe(true);
  });
});

describe('replacing and removing a row picture', () => {
  it('a replace stores the new key and deletes the row\'s previous picture', async () => {
    const { rowId, key } = await rowWithPicture();
    const upload = await picture();

    await caller().collectionLayout.rows.update({ rowId, data: { pendingPictureFileObjectId: upload.id } });

    expect(await storedKey(rowId)).toBe(upload.key);
    expect(await fileExists(key)).toBe(false);
  });

  it('removePicture clears the row and deletes its picture', async () => {
    const { rowId, key } = await rowWithPicture();

    await caller().collectionLayout.rows.update({ rowId, data: { removePicture: true } });

    expect(await storedKey(rowId)).toBeNull();
    expect(await fileExists(key)).toBe(false);
  });

  it('refuses removePicture together with a pending upload, and changes nothing', async () => {
    const { rowId, key } = await rowWithPicture();
    const upload = await picture();

    await expect(caller().collectionLayout.rows.update({
      rowId, data: { removePicture: true, pendingPictureFileObjectId: upload.id },
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await storedKey(rowId)).toBe(key);
    expect(await fileExists(key)).toBe(true);
  });

  it('a replace that waited on a concurrent one deletes the picture that one stored', async () => {
    const { rowId } = await rowWithPicture();
    const [concurrent, mine] = await Promise.all([picture(), picture()]);

    // The held transaction is a concurrent save: it holds the row and stores its own picture, and
    // this save must read that one, not the picture it found before waiting.
    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM collection_layout_rows WHERE id = $1 FOR UPDATE', [rowId]),
      () => caller().collectionLayout.rows.update({ rowId, data: { pendingPictureFileObjectId: mine.id } }),
      holder => holder.query('UPDATE collection_layout_rows SET "pictureKey" = $1 WHERE id = $2', [concurrent.key, rowId])
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await storedKey(rowId)).toBe(mine.key);
    expect(await fileExists(concurrent.key)).toBe(false);
  });
});

describe('an unusable pending file refuses the save', () => {
  it.each([
    ['another user\'s upload', () => picture({ createdBy: otherUserId })],
    ['an upload in another bucket', () => picture({ bucket: 'brand-logos' })],
    ['an upload already linked', () => picture({ confirmed: true })],
    ['a missing upload', async () => ({ id: randomUUID(), key: 'none' })],
  ])('%s: BAD_REQUEST, and the row is unchanged', async (_, upload) => {
    const { rowId, key } = await rowWithPicture();
    const { id } = await upload();

    await expect(caller().collectionLayout.rows.update({
      rowId, data: { pendingPictureFileObjectId: id, line: 'Modificata' },
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const row = await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: rowId }, select: { line: true, pictureKey: true } });
    expect(row.line).not.toBe('Modificata');
    expect(row.pictureKey).toBe(key);
  });
});

describe('confirmPendingFile is an atomic claim', () => {
  it('a confirmation that waited on another one finds nothing left to claim', async () => {
    const upload = await picture();

    // The held transaction is the first confirmation, not yet committed.
    const outcome = await whileHeld(
      holder => holder.query('UPDATE file_objects SET "confirmedAt" = now() WHERE id = $1 AND "confirmedAt" IS NULL', [upload.id]),
      () => prisma.$transaction(tx => confirmPendingFile(tx, { fileObjectId: upload.id, bucket: 'collection-row-pictures', userId }))
    );

    expect(outcome).toEqual({ status: 'fulfilled', value: null });
  });
});
