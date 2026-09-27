/**
 * Who can put bytes into the immutable `collection-row-pictures-revisions` bucket, the ISO 9001
 * revision register.
 *
 * The presigned `storage.requestUpload` / `confirmUpload` pair accepted every application bucket for
 * any authenticated user and recorded the checksum the client declared; `copyToImmutableBucket`
 * then reused any row of the bucket with a matching checksum. So a viewer could upload an image of
 * their own, declare the SHA-256 of a live row photo, and have the next revision of that row point
 * at it. The pair now serves `PRESIGNED_UPLOAD_BUCKETS` only, to holders of that bucket's permission,
 * and the copier trusts only its own copies.
 */

import { createHash, randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { copyToImmutableBucket, getStorageProvider, resetStorageProvider } from '../src/storage';
import { signUploadToken } from '../src/utils/downloadToken';

import { createCallerAs, createTestUser, createCallerWithSession, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

const REVISIONS = 'collection-row-pictures-revisions';

let prisma: PrismaClient;
let basePath: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  basePath = await mkdtemp(join(tmpdir(), 'luke-immutable-writes-'));
  await seedLocalStorageConfig(prisma, basePath);
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();
});

afterEach(async () => {
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('the presigned upload pair', () => {
  const slot = { contentType: 'image/png', size: 100, originalName: 'x.png' };

  it.each([REVISIONS, 'uploads', 'collection-row-pictures'] as const)(
    'refuses a slot in %s',
    async bucket => {
      const caller = await createCallerAs('admin');
      await expect(
        // @ts-expect-error — the bucket is outside PRESIGNED_UPLOAD_BUCKETS, which is the point
        caller.storage.requestUpload({ ...slot, bucket }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    },
  );

  it('still grants a slot in company-assets', async () => {
    const caller = await createCallerAs('admin');
    // Local storage answers with the proxy fallback; what matters is that the bucket is accepted.
    await expect(
      caller.storage.requestUpload({ ...slot, bucket: 'company-assets' }),
    ).resolves.toMatchObject({ method: 'proxy' });
  });

  it('refuses to confirm a slot signed for another bucket before the list was narrowed', async () => {
    const { session } = await createTestUser('admin');
    const uploadToken = signUploadToken({ bucket: REVISIONS, key: '2026/09/27/x.png', userId: session.user.id });

    await expect(
      createCallerWithSession(session).storage.confirmUpload({ uploadToken, ...slot }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.fileObject.count({ where: { bucket: REVISIONS } })).toBe(0);
  });
});

describe('who may use the presigned upload pair', () => {
  const slot = { contentType: 'image/png', size: 100, originalName: 'x.png' };
  const key = '2026/09/27/x.png';

  // company-assets holds the logo `company.update` links, which needs company_profile:update.
  it.each(['viewer', 'editor'] as const)('refuses a slot to role %s', async role => {
    const caller = await createCallerAs(role);
    await expect(
      caller.storage.requestUpload({ ...slot, bucket: 'company-assets' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['viewer', 'editor'] as const)('refuses role %s confirming a slot signed for it', async role => {
    const { session } = await createTestUser(role);
    const uploadToken = signUploadToken({ bucket: 'company-assets', key, userId: session.user.id });

    await expect(
      createCallerWithSession(session).storage.confirmUpload({ uploadToken, ...slot }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.fileObject.count({ where: { bucket: 'company-assets' } })).toBe(0);
  });

  // Both pass the permission gate, so this isolates the slot's ownership check.
  it("refuses an admin confirming another admin's slot, and lets its owner confirm it", async () => {
    const owner = await createTestUser('admin');
    const other = await createTestUser('admin');
    const uploadToken = signUploadToken({ bucket: 'company-assets', key, userId: owner.session.user.id });

    await expect(
      createCallerWithSession(other.session).storage.confirmUpload({ uploadToken, ...slot }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createCallerWithSession(owner.session).storage.confirmUpload({ uploadToken, ...slot }),
    ).resolves.toMatchObject({ key });
  });
});

describe('copyToImmutableBucket dedup', () => {
  /** A live row photo with its `FileObject`, and its SHA-256. */
  async function livePhoto() {
    const bytes = createValidPngBuffer();
    const provider = await getStorageProvider(prisma);
    const { key } = await provider.put({
      bucket: 'collection-row-pictures',
      originalName: 'row.png',
      contentType: 'image/png',
      size: bytes.byteLength,
      stream: Readable.from(bytes),
    });
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    await prisma.fileObject.create({
      data: {
        bucket: 'collection-row-pictures', key, originalName: 'row.png', size: bytes.byteLength,
        contentType: 'image/png', checksumSha256, createdBy: 'uploader', confirmedAt: new Date(),
      },
    });
    return { key, checksumSha256 };
  }

  it('ignores a row a client planted with the photo’s checksum', async () => {
    const { key, checksumSha256 } = await livePhoto();
    // What `confirmUpload` used to create: the client's own id, pending, a declared checksum.
    await prisma.fileObject.create({
      data: {
        id: randomUUID(), bucket: REVISIONS, key: 'planted/image.png', originalName: 'image.png',
        size: 1, contentType: 'image/png', checksumSha256, createdBy: randomUUID(), confirmedAt: null,
      },
    });

    const copied = await copyToImmutableBucket(prisma, key);

    expect(copied).not.toBe('planted/image.png');
    expect(await prisma.fileObject.count({ where: { bucket: REVISIONS, key: copied, createdBy: 'system' } })).toBe(1);
  });

  it('still reuses its own copy: same key, no second object', async () => {
    const { key } = await livePhoto();

    const first = await copyToImmutableBucket(prisma, key);
    const second = await copyToImmutableBucket(prisma, key);

    expect(second).toBe(first);
    expect(await prisma.fileObject.count({ where: { bucket: REVISIONS } })).toBe(1);
  });
});
