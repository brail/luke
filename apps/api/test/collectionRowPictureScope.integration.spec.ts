/**
 * `POST /upload/collection-row-picture/:rowId` checks brand scope on the row's layout.
 *
 * It checked only `collection_layout:update` and that the row existed, so a user scoped to one brand
 * could store files against another brand's rows and learn which row ids exist. The key only reaches
 * the database through the guarded `rows.update`, but the file was stored all the same.
 */

import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import collectionRowPictureRoutes from '../src/routes/collectionRowPicture.routes';
import { resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

import type { UserSession } from '../src/lib/auth';

// The mock hands the route the scoped editor's real session, so the brand check runs on real data.
const routeAuth = vi.hoisted(() => ({ session: null as UserSession | null }));
vi.mock('../src/lib/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/auth')>();
  return { ...actual, requireSessionWithPermission: vi.fn(async () => routeAuth.session) };
});

let prisma: PrismaClient;
let app: FastifyInstance;
let basePath: string;
let inRowId: string;
let outRowId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [editor, admin, inBrand, outBrand, season] = await Promise.all([
    createTestUser('editor'),
    createTestUser('admin'),
    prisma.brand.create({ data: { code: `PIN${uid}`, name: `In ${uid}`, isActive: true } }),
    prisma.brand.create({ data: { code: `POUT${uid}`, name: `Out ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `P${uid}`, name: `Season ${uid}`, year: 2036, isActive: true } }),
  ]);
  const fn = await prisma.companyFunction.create({
    data: { slug: `pic_fn_${uid.toLowerCase()}`, name: `Pic Fn ${uid}`, order: 96, isActive: true },
  });
  const team = await prisma.companyTeam.create({ data: { functionId: fn.id, name: `Pic Team ${uid}`, isActive: true } });
  await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId: editor.user.id } });
  await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: inBrand.id } });

  const asAdmin = createCallerWithSession(admin.session);
  const buildRow = async (brandId: string) => {
    const layout = await asAdmin.collectionLayout.getOrCreate({ brandId, seasonId: season.id, availableGenders: ['MAN'] });
    const group = await asAdmin.collectionLayout.groups.create({ collectionLayoutId: layout.id, data: { name: 'Gruppo', order: 0 } });
    const row = await asAdmin.collectionLayout.rows.create({
      groupId: group.id, gender: 'MAN', line: 'Linea', status: COLLECTION_STATUS[0],
      productCategory: 'TEST', skuForecast: null, qtyForecast: null,
    });
    return row.id;
  };
  inRowId = await buildRow(inBrand.id);
  outRowId = await buildRow(outBrand.id);

  basePath = await mkdtemp(join(tmpdir(), 'luke-row-picture-'));
  await seedLocalStorageConfig(prisma, basePath);
  await prisma.appConfig.update({ where: { key: 'storage.derivatives.enabled' }, data: { value: 'false' } });
  resetStorageProvider();

  routeAuth.session = editor.session;
  app = fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(collectionRowPictureRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('POST /upload/collection-row-picture/:rowId', () => {
  it('refuses a row of another brand before storing anything', async () => {
    const files = await prisma.fileObject.count();

    const response = await request(app.server)
      .post(`/upload/collection-row-picture/${outRowId}`)
      .attach('file', createValidPngBuffer(), 'row.png');

    expect(response.status).toBe(403);
    expect(await prisma.fileObject.count()).toBe(files);
  });

  it('accepts a row of the user’s brand', async () => {
    const response = await request(app.server)
      .post(`/upload/collection-row-picture/${inRowId}`)
      .attach('file', createValidPngBuffer(), 'row.png');

    expect(response.status).toBe(200);
  });
});
