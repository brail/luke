/**
 * Brand scope on the merchandising plan.
 *
 * Every merchandising procedure addresses a plan, row, specsheet or image by id, and ten of them
 * used to act on it with only the role check: an editor whose team is scoped to brand A could
 * read, edit, reorder or delete brand B's plan by passing its ids. The specsheet image upload
 * route had the same gap. The brand now comes from the resolved record, as in the collection
 * layout (`brandScope.integration.spec.ts`).
 */

import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import specsheetImageRoutes from '../src/routes/specsheetImage.routes';
import { resetStorageProvider } from '../src/storage';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { createValidPngBuffer, seedLocalStorageConfig } from './helpers/storageTestHelper';

import type { UserSession } from '../src/lib/auth';

// The upload route authenticates through `requireSessionWithPermission`; the mock hands it the
// scoped editor's real session, so the brand check runs against real team data.
const routeAuth = vi.hoisted(() => ({ session: null as UserSession | null }));
vi.mock('../src/lib/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/auth')>();
  return { ...actual, requireSessionWithPermission: vi.fn(async () => routeAuth.session) };
});

let prisma: PrismaClient;
/** Editor in a team scoped to the IN brand only. */
let editorSession: UserSession;
/** Viewer in the same team. */
let viewerSession: UserSession;

interface PlanFixture {
  planId: string;
  rowId: string;
  specsheetId: string;
  /** The default image. */
  imageId: string;
  /** A second, non-default image. */
  otherImageId: string;
}
const outRes = {} as PlanFixture;
const inRes = {} as PlanFixture;

const rowInput = {
  articleCode: 'ART-1',
  styleDescription: 'Style',
  colorCode: 'C1',
  colorDescription: 'Black',
  gender: 'MAN' as const,
  productCategory: 'SNEAKER',
};

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const [editor, viewer, admin, inBrand, outBrand, season] = await Promise.all([
    createTestUser('editor'),
    createTestUser('viewer'),
    createTestUser('admin'),
    prisma.brand.create({ data: { code: `MIN${uid}`, name: `In ${uid}`, isActive: true } }),
    prisma.brand.create({ data: { code: `MOUT${uid}`, name: `Out ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `M${uid}`, name: `Season ${uid}`, year: 2032, isActive: true } }),
  ]);
  editorSession = editor.session;
  viewerSession = viewer.session;

  const fn = await prisma.companyFunction.create({
    data: { slug: `merch_fn_${uid.toLowerCase()}`, name: `Merch Fn ${uid}`, order: 95, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `Merch Team ${uid}`, isActive: true },
  });
  await prisma.companyTeamMembership.createMany({
    data: [
      { teamId: team.id, userId: editor.user.id },
      { teamId: team.id, userId: viewer.user.id },
    ],
  });
  await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: inBrand.id } });

  const asAdmin = createCallerWithSession(admin.session);
  const build = async (brandId: string, into: PlanFixture) => {
    const plan = await asAdmin.merchandisingPlan.getOrCreate({ brandId, seasonId: season.id });
    const row = await asAdmin.merchandisingPlan.createRow({ ...rowInput, planId: plan.id });
    const specsheet = await asAdmin.merchandisingPlan.upsertSpecsheet({
      rowId: row.id,
      supplierName: 'Supplier',
    });
    await asAdmin.merchandisingPlan.upsertComponents({
      specsheetId: specsheet.id,
      components: [{ component: 'Upper', section: 'UPPER', order: 0 }],
    });
    // No procedure creates an image since `addImage` was removed; the upload route does, and
    // it is exercised on its own below.
    const [image, other] = await Promise.all([
      prisma.merchandisingImage.create({
        data: { specsheetId: specsheet.id, key: `k-${randomUUID()}`, isDefault: true, order: 0 },
      }),
      prisma.merchandisingImage.create({
        data: { specsheetId: specsheet.id, key: `k-${randomUUID()}`, isDefault: false, order: 1 },
      }),
    ]);
    Object.assign(into, {
      planId: plan.id,
      rowId: row.id,
      specsheetId: specsheet.id,
      imageId: image.id,
      otherImageId: other.id,
    });
  };
  await build(outBrand.id, outRes);
  await build(inBrand.id, inRes);
});

/** Everything a refused call must leave as it was on the OUT plan. */
async function outState() {
  return {
    plan: await prisma.merchandisingPlan.findUnique({
      where: { id: outRes.planId },
      select: { status: true },
    }),
    rows: await prisma.merchandisingPlanRow.findMany({
      where: { planId: outRes.planId },
      select: { id: true, articleCode: true, order: true, assignedUserId: true },
      orderBy: { id: 'asc' },
    }),
    specsheet: await prisma.merchandisingSpecsheet.findUnique({
      where: { id: outRes.specsheetId },
      select: { supplierName: true },
    }),
    components: await prisma.merchandisingComponent.findMany({
      where: { specsheetId: outRes.specsheetId },
      select: { id: true, component: true },
      orderBy: { id: 'asc' },
    }),
    images: await prisma.merchandisingImage.findMany({
      where: { specsheetId: outRes.specsheetId },
      select: { id: true, isDefault: true },
      orderBy: { id: 'asc' },
    }),
  };
}

describe('merchandising plan — out-of-scope brand', () => {
  const editorCalls = {
    updateStatus: () =>
      asEditor().merchandisingPlan.updateStatus({ planId: outRes.planId, status: 'CONFIRMED' }),
    listRows: () => asEditor().merchandisingPlan.listRows({ planId: outRes.planId }),
    createRow: () => asEditor().merchandisingPlan.createRow({ ...rowInput, planId: outRes.planId }),
    updateRow: () =>
      asEditor().merchandisingPlan.updateRow({ id: outRes.rowId, data: { articleCode: 'CHANGED' } }),
    deleteRow: () => asEditor().merchandisingPlan.deleteRow({ id: outRes.rowId }),
    reorderRows: () =>
      asEditor().merchandisingPlan.reorderRows({
        planId: outRes.planId,
        rows: [{ id: outRes.rowId, order: 9 }],
      }),
    getSpecsheet: () => asEditor().merchandisingPlan.getSpecsheet({ rowId: outRes.rowId }),
    upsertSpecsheet: () =>
      asEditor().merchandisingPlan.upsertSpecsheet({ rowId: outRes.rowId, supplierName: 'CHANGED' }),
    upsertComponents: () =>
      asEditor().merchandisingPlan.upsertComponents({ specsheetId: outRes.specsheetId, components: [] }),
    deleteImage: () => asEditor().merchandisingPlan.deleteImage({ id: outRes.imageId }),
    setDefaultImage: () => asEditor().merchandisingPlan.setDefaultImage({ id: outRes.otherImageId }),
    assignUser: () =>
      asEditor().merchandisingPlan.assignUser({ rowId: outRes.rowId, userId: editorSession.user.id }),
  };

  it.each(Object.keys(editorCalls) as Array<keyof typeof editorCalls>)(
    '%s → FORBIDDEN, and the plan is untouched',
    async name => {
      const before = await outState();

      await expect(editorCalls[name]()).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(await outState()).toEqual(before);
    },
  );

  it('a viewer of the other brand cannot read the rows or a specsheet', async () => {
    const asViewer = createCallerWithSession(viewerSession);

    await expect(
      asViewer.merchandisingPlan.listRows({ planId: outRes.planId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      asViewer.merchandisingPlan.getSpecsheet({ rowId: outRes.rowId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an in-scope plan cannot reach a row of another plan', async () => {
    const before = await outState();

    // The guard passes on the IN plan; the update is confined by `{ id, planId }`.
    await expect(
      asEditor().merchandisingPlan.reorderRows({
        planId: inRes.planId,
        rows: [{ id: outRes.rowId, order: 9 }],
      }),
    ).rejects.toThrow();

    expect(await outState()).toEqual(before);
  });
});

describe('merchandising plan — unknown ids are NOT_FOUND, not FORBIDDEN', () => {
  it.each([
    ['plan', () => asEditor().merchandisingPlan.listRows({ planId: randomUUID() })],
    ['specsheet', () =>
      asEditor().merchandisingPlan.upsertComponents({ specsheetId: randomUUID(), components: [] })],
    ['image', () => asEditor().merchandisingPlan.deleteImage({ id: randomUUID() })],
  ] as const)('%s', async (_resource, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('merchandising plan — in-scope brand', () => {
  it('reads, edits and changes the default image', async () => {
    const rows = await asEditor().merchandisingPlan.listRows({ planId: inRes.planId });
    expect(rows.map(r => r.id)).toContain(inRes.rowId);

    const updated = await asEditor().merchandisingPlan.updateRow({
      id: inRes.rowId,
      data: { articleCode: 'IN-EDITED' },
    });
    expect(updated.articleCode).toBe('IN-EDITED');

    await asEditor().merchandisingPlan.setDefaultImage({ id: inRes.otherImageId });
    const image = await prisma.merchandisingImage.findUnique({ where: { id: inRes.otherImageId } });
    expect(image?.isDefault).toBe(true);
  });
});

describe('POST /upload/specsheet-image/:specsheetId', () => {
  let app: FastifyInstance;
  let basePath: string;

  beforeAll(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'luke-specsheet-image-'));
    await seedLocalStorageConfig(prisma, basePath);
    // No background derivative work outliving the test (see the header of
    // `brandLogo.routes.integration.spec.ts`).
    await prisma.appConfig.update({
      where: { key: 'storage.derivatives.enabled' },
      data: { value: 'false' },
    });
    resetStorageProvider();

    routeAuth.session = editorSession;
    app = fastify({ logger: false });
    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    await app.register(specsheetImageRoutes, { prisma });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    resetStorageProvider();
    await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('refuses the other brand’s specsheet before storing anything', async () => {
    const [images, files] = await Promise.all([
      prisma.merchandisingImage.count({ where: { specsheetId: outRes.specsheetId } }),
      prisma.fileObject.count(),
    ]);

    const response = await request(app.server)
      .post(`/upload/specsheet-image/${outRes.specsheetId}`)
      .attach('file', createValidPngBuffer(), 'image.png');

    expect(response.status).toBe(403);
    expect(await prisma.merchandisingImage.count({ where: { specsheetId: outRes.specsheetId } }))
      .toBe(images);
    expect(await prisma.fileObject.count()).toBe(files);
  });

  it('accepts an upload on the in-scope specsheet', async () => {
    const images = await prisma.merchandisingImage.count({ where: { specsheetId: inRes.specsheetId } });

    const response = await request(app.server)
      .post(`/upload/specsheet-image/${inRes.specsheetId}`)
      .attach('file', createValidPngBuffer(), 'image.png');

    expect(response.status).toBe(200);
    expect(await prisma.merchandisingImage.count({ where: { specsheetId: inRes.specsheetId } }))
      .toBe(images + 1);
  });
});

function asEditor() {
  return createCallerWithSession(editorSession);
}
