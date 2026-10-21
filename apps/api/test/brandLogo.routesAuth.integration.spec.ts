/**
 * The two brand-logo upload routes check `brands:update` / `brands:create` on the real session.
 * `brandLogo.routes.integration.spec.ts` mocks that check to an admin, so it proves nothing for the
 * other roles: here a real signed token goes through `requireSessionWithPermission`. Editor and
 * viewer get 403 before the file is read, and nothing is stored. Admin gets past the check — a
 * request without a file answers 400, not 403 — without touching storage.
 */

import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createToken } from '../src/lib/auth';
import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer } from './helpers/storageTestHelper';

let prisma: PrismaClient;
let app: FastifyInstance;
let brandId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  brandId = (await prisma.brand.create({ data: { code: 'LOGO_AUTH', name: 'Logo Auth' } })).id;
  app = fastify({ logger: false });
  await app.register(multipart);
  await app.register(brandLogoRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function bearer(role: 'admin' | 'editor' | 'viewer') {
  const { user } = await createTestUser(role);
  return `Bearer ${createToken({ ...user, tokenVersion: user.tokenVersion ?? 0 }, Math.floor(Date.now() / 1000))}`;
}

const ROUTES = [
  ['brands:update', () => `/upload/brand-logo/${brandId}`],
  ['brands:create', () => '/upload/brand-logo/temp'],
] as const;

describe.each(ROUTES)('the %s upload route', (_permission, path) => {
  it.each(['editor', 'viewer'] as const)('refuses %s with 403 and stores nothing', async role => {
    const response = await request(app.server)
      .post(path())
      .set('authorization', await bearer(role))
      .attach('file', createValidPngBuffer(), 'logo.png');

    expect(response.status).toBe(403);
    expect(await prisma.fileObject.count()).toBe(0);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: brandId } })).logoKey).toBeNull();
  });

  it('lets admin through the permission check', async () => {
    const response = await request(app.server)
      .post(path())
      .set('authorization', await bearer('admin'))
      .field('note', 'no file');

    expect(response.status).toBe(400);
  });
});
