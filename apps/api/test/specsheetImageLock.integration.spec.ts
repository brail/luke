/**
 * A specsheet's images are written under one lock: upload, delete and set-default each take a
 * transaction-scoped advisory lock keyed by the specsheet, then decide on what they re-read under it.
 *
 * Every case is a fixed sequence, not a race the scheduler may or may not produce. The test takes
 * the lock itself on its own connection, starts the writer, and waits until `pg_locks` shows a
 * backend waiting on that very lock with the test connection as its blocker (no waiter within five
 * seconds fails the test — a writer that never takes the lock never shows up). While the writer
 * waits, the test changes what it will re-read, then commits, which releases the lock.
 *
 * The writer runs on a pooled Prisma connection, so its backend PID is not at hand without wrapping
 * its transaction to report `pg_backend_pid()`. The waiter is attributed by exclusion instead, in
 * this file's isolated fixture: no backend waits on the lock before the writer starts, exactly one
 * does while it runs, and none once it has settled.
 */

import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as pendingFile from '../src/lib/pendingFile';
import { uploadSpecsheetImage } from '../src/services/specsheetImage.service';
import { resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestContext, createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let session: UserSession;
let specsheetId: string;
let basePath: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  basePath = await mkdtemp(join(tmpdir(), 'luke-specsheet-lock-'));
  await seedLocalStorageConfig(prisma, basePath);
  // No background derivative work outliving the test.
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();

  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [admin, brand, season] = await Promise.all([
    createTestUser('admin'),
    prisma.brand.create({ data: { code: `LK${uid}`, name: `Lock ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `L${uid}`, name: `Season ${uid}`, year: 2033, isActive: true } }),
  ]);
  session = admin.session;
  const caller = createCallerWithSession(session);
  const plan = await caller.merchandisingPlan.getOrCreate({ brandId: brand.id, seasonId: season.id });
  const row = await caller.merchandisingPlan.createRow({
    planId: plan.id, articleCode: 'ART-1', styleDescription: 'Style', colorCode: 'C1',
    colorDescription: 'Black', gender: 'MAN', productCategory: 'SNEAKER',
  });
  specsheetId = (await caller.merchandisingPlan.upsertSpecsheet({ rowId: row.id, supplierName: 'S' })).id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(basePath, { recursive: true, force: true });
});

async function image(order: number, isDefault: boolean) {
  return prisma.merchandisingImage.create({
    data: { specsheetId, key: `k-${randomUUID()}`, isDefault, order },
  });
}

/**
 * Takes the specsheet's lock on a connection of its own, runs `writer`, waits until that writer
 * blocks on the lock, applies `meanwhile` inside the holding transaction, and commits. Returns the
 * writer's outcome. The connection is always rolled back or committed and closed, and the writer
 * always drained, timeouts included.
 */
async function whileLocked<T>(
  writer: () => Promise<T>,
  meanwhile: (holder: Client) => Promise<void>
): Promise<PromiseSettledResult<T>> {
  const holder = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await holder.connect();
  let running: Promise<PromiseSettledResult<T>> | undefined;
  let committed = false;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`merchandising-specsheet-images:${specsheetId}`]);
    const { rows: [held] } = await holder.query<{ pid: number; database: number; classid: number; objid: number; objsubid: number }>(
      `SELECT pid, database, classid, objid, objsubid FROM pg_locks
        WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted`
    );
    // Every backend waiting on that very lock (database and full lock identity), with its blockers.
    const waiters = async () =>
      (await holder.query<{ pid: number; blockers: number[] }>(
        `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = $1 AND classid = $2 AND objid = $3 AND objsubid = $4`,
        [held!.database, held!.classid, held!.objid, held!.objsubid]
      )).rows;
    expect(await waiters()).toEqual([]);

    running = writer().then(
      value => ({ status: 'fulfilled', value }) as const,
      reason => ({ status: 'rejected', reason }) as const
    );

    const deadline = Date.now() + 5000;
    for (;;) {
      const now = await waiters();
      if (now.length === 1 && now[0]!.blockers.includes(held!.pid)) break;
      if (now.length > 1) throw new Error(`more than one backend waits on the lock: ${JSON.stringify(now)}`);
      if (Date.now() > deadline) throw new Error('no writer waited on the specsheet image lock within 5 s');
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    await meanwhile(holder);
    await holder.query('COMMIT');
    committed = true;
    const outcome = await running;
    expect(await waiters()).toEqual([]);
    return outcome;
  } finally {
    if (!committed) await holder.query('ROLLBACK').catch(() => undefined);
    await holder.end();
    if (running) await running;
  }
}

const upload = () =>
  uploadSpecsheetImage(createTestContext(session), {
    specsheetId,
    file: { filename: 'image.png', mimetype: 'image/png', stream: Readable.from(createValidPngBuffer()), size: createValidPngBuffer().length },
  });

const imagesNow = () =>
  prisma.merchandisingImage.findMany({ where: { specsheetId }, select: { id: true, isDefault: true, order: true }, orderBy: { order: 'asc' } });

describe('specsheet images under the lock', () => {
  it('an upload waits, then sees the default inserted meanwhile and appends after it', async () => {
    const outcome = await whileLocked(upload, async holder => {
      await holder.query(
        `INSERT INTO merchandising_images (id, "specsheetId", key, "isDefault", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, 5, now(), now())`,
        [randomUUID(), specsheetId, `k-${randomUUID()}`]
      );
    });

    expect(outcome.status).toBe('fulfilled');
    const added = (outcome as PromiseFulfilledResult<{ id: string }>).value;
    const rows = await imagesNow();
    expect(rows.filter(r => r.isDefault)).toHaveLength(1);
    expect(rows.find(r => r.id === added.id)).toMatchObject({ isDefault: false, order: 6 });
  });

  it('an upload whose specsheet is deleted meanwhile answers NOT_FOUND and leaves its file pending', async () => {
    const before = new Date();
    const outcome = await whileLocked(upload, async holder => {
      await holder.query('DELETE FROM merchandising_specsheets WHERE id = $1', [specsheetId]);
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect(await prisma.merchandisingImage.count({ where: { specsheetId } })).toBe(0);
    const files = await prisma.fileObject.findMany({
      where: { bucket: 'merchandising-specsheet-images', parentId: null, createdAt: { gte: before } },
      select: { confirmedAt: true },
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.confirmedAt).toBeNull();
  });

  it('an upload whose specsheet goes after the re-read answers NOT_FOUND and rolls back the file confirmation', async () => {
    const before = new Date();
    const confirm = pendingFile.confirmPendingFile;
    vi.spyOn(pendingFile, 'confirmPendingFile').mockImplementation(async (tx, params) => {
      // The real confirmation, inside the upload's transaction ...
      const key = await confirm(tx, params);
      // ... then the specsheet goes, from another connection: a cascade takes no lock, so it can
      // land between the re-read and the insert.
      const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await other.connect();
      try {
        await other.query('DELETE FROM merchandising_specsheets WHERE id = $1', [specsheetId]);
      } finally {
        await other.end();
      }
      return key;
    });

    await expect(upload()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.merchandisingImage.count({ where: { specsheetId } })).toBe(0);
    const files = await prisma.fileObject.findMany({
      where: { bucket: 'merchandising-specsheet-images', parentId: null, createdAt: { gte: before } },
      select: { confirmedAt: true },
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.confirmedAt).toBeNull();
  });

  it('a delete of an image deleted meanwhile answers NOT_FOUND', async () => {
    const target = await image(0, true);
    const caller = createCallerWithSession(session);
    const outcome = await whileLocked(() => caller.merchandisingPlan.deleteImage({ id: target.id }), async holder => {
      await holder.query('DELETE FROM merchandising_images WHERE id = $1', [target.id]);
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
  });

  it('a delete decides on the image as re-read: no promotion when it stopped being the default', async () => {
    const first = await image(0, true);
    const second = await image(1, false);
    const third = await image(2, false);
    const caller = createCallerWithSession(session);

    const outcome = await whileLocked(() => caller.merchandisingPlan.deleteImage({ id: first.id }), async holder => {
      // The default moves to the third image, not to the first promotion candidate (the second).
      await holder.query('UPDATE merchandising_images SET "isDefault" = (id = $2) WHERE "specsheetId" = $1', [specsheetId, third.id]);
    });

    expect(outcome.status).toBe('fulfilled');
    const rows = await imagesNow();
    expect(rows.map(r => r.id)).toEqual([second.id, third.id]);
    expect(rows.filter(r => r.isDefault).map(r => r.id)).toEqual([third.id]);
  });

  it('a set-default of an image deleted meanwhile answers NOT_FOUND and keeps the previous default', async () => {
    const current = await image(0, true);
    const target = await image(1, false);
    const caller = createCallerWithSession(session);

    const outcome = await whileLocked(() => caller.merchandisingPlan.setDefaultImage({ id: target.id }), async holder => {
      await holder.query('DELETE FROM merchandising_images WHERE id = $1', [target.id]);
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect((await imagesNow()).filter(r => r.isDefault).map(r => r.id)).toEqual([current.id]);
  });
});

describe('specsheet images, one writer at a time', () => {
  it('the first upload into an empty gallery is the default, the next one is not', async () => {
    const a = await upload();
    const b = await upload();
    const rows = await imagesNow();
    expect(rows).toEqual([
      { id: a.id, isDefault: true, order: 0 },
      { id: b.id, isDefault: false, order: 1 },
    ]);
  });

  it('deleting the default promotes the next image by order', async () => {
    const first = await image(0, true);
    const second = await image(1, false);
    await createCallerWithSession(session).merchandisingPlan.deleteImage({ id: first.id });
    expect((await imagesNow()).filter(r => r.isDefault).map(r => r.id)).toEqual([second.id]);
  });
});
