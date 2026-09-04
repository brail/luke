/**
 * Brand scope: permission is not access.
 *
 * `requirePermission('pricing:read')` answers "can this role read
 * prices?". It does not answer "can this user read prices **for this
 * brand**?". The two questions were conflated in five routers: an editor with the
 * permission, but whose team is scoped to brand A only, could export the price
 * grid for brand B by passing its UUID — retrievable from the filename of a shared
 * PDF or from an audit log row.
 *
 * Access is **strict opt-in**: `null` (no constraint) is reserved for
 * admins; for everyone else it's exactly the union of the `brandScopes` of the
 * active teams the user belongs to.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import {
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;

/** Editor who is a member of a team scoped to `inScopeBrandId` only. */
let scopedSession: UserSession;
/** Admin: `getUserAllowedBrandIds` returns `null`, no constraint. */
let adminSession: UserSession;

let inScopeBrandId: string;
let outOfScopeBrandId: string;
let seasonId: string;

/**
 * Resources for the brand **out of scope**: these are the targets of the FORBIDDEN table.
 *
 * Built by going through the router as admin instead of with direct Prisma: rows
 * require a planning group, which requires a calendar, and `createRow`
 * already knows how to resolve the default one. Fewer fixtures and, more importantly, the
 * real path.
 */
const outRes = {
  layoutId: '',
  groupId: '',
  rowId: '',
  quotationId: '',
  revisionId: '',
};

/** The same resources on the in-scope brand, for the positive cases. */
const inRes = { layoutId: '', rowId: '' };

beforeAll(async () => {
  prisma = await setupTestDb();

  const uid = randomUUID().substring(0, 6).toUpperCase();

  const [editor, admin, inScope, outOfScope, season] = await Promise.all([
    createTestUser('editor'),
    createTestUser('admin'),
    prisma.brand.create({
      data: { code: `IN${uid}`, name: `In scope ${uid}`, isActive: true },
    }),
    prisma.brand.create({
      data: { code: `OUT${uid}`, name: `Out of scope ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: { code: `S${uid}`, name: `Season ${uid}`, year: 2031, isActive: true },
    }),
  ]);

  scopedSession = editor.session;
  adminSession = admin.session;
  inScopeBrandId = inScope.id;
  outOfScopeBrandId = outOfScope.id;
  seasonId = season.id;

  const fn = await prisma.companyFunction.create({
    data: { slug: `scope_fn_${uid.toLowerCase()}`, name: `Scope Fn ${uid}`, order: 94, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `Scope Team ${uid}`, isActive: true },
  });

  await Promise.all([
    prisma.companyTeamMembership.create({
      data: { teamId: team.id, userId: editor.user.id },
    }),
    // Scoped to the "in" brand only: this is what puts the other one out of reach.
    prisma.companyTeamBrandScope.create({
      data: { teamId: team.id, brandId: inScopeBrandId },
    }),
  ]);

  const asAdmin = createCallerWithSession(adminSession);

  const buildLayout = async (brandId: string) => {
    const layout = await asAdmin.collectionLayout.getOrCreate({
      brandId,
      seasonId,
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
    return { layoutId: layout.id, groupId: group.id, rowId: row.id };
  };

  const built = await buildLayout(outOfScopeBrandId);
  outRes.layoutId = built.layoutId;
  outRes.groupId = built.groupId;
  outRes.rowId = built.rowId;

  const quotation = await asAdmin.collectionLayout.quotations.create({
    rowId: outRes.rowId,
  });
  outRes.quotationId = quotation.id;

  // The revision by hand: `create` validates `revisionTypeValue` against a catalog
  // that this spec has no reason to seed.
  const revision = await prisma.collectionLayoutRevision.create({
    data: {
      collectionLayoutId: outRes.layoutId,
      revisionNumber: 1,
      revisionTypeValue: 'TEST',
      cause: 'MANUAL',
      createdByUserId: admin.user.id,
    },
  });
  outRes.revisionId = revision.id;

  const inBuilt = await buildLayout(inScopeBrandId);
  inRes.layoutId = inBuilt.layoutId;
  inRes.rowId = inBuilt.rowId;
});

describe('brand scope — pricing', () => {
  /** Each case: label, and the call parameterized on the brand. */
  const cases: [string, (session: UserSession, brandId: string) => Promise<unknown>][] = [
    ['export.pdf', (s, brandId) =>
      createCallerWithSession(s).pricing.export.pdf({ brandId, seasonId })],
    ['export.xlsx', (s, brandId) =>
      createCallerWithSession(s).pricing.export.xlsx({ brandId, seasonId })],
    ['parameterSets.list', (s, brandId) =>
      createCallerWithSession(s).pricing.parameterSets.list({ brandId, seasonId })],
  ];

  it.each(cases)('%s su un brand fuori scope → FORBIDDEN', async (_label, invoke) => {
    await expectUnauthorized(
      () => invoke(scopedSession, outOfScopeBrandId),
      'FORBIDDEN'
    );
  });

  it('il brand in scope non è bloccato dal guard', async () => {
    // `list` is the only one of the three that doesn't require already-existing parameters:
    // once past the guard it must reach the result, not a FORBIDDEN.
    await expect(
      createCallerWithSession(scopedSession).pricing.parameterSets.list({
        brandId: inScopeBrandId,
        seasonId,
      })
    ).resolves.toBeInstanceOf(Array);
  });

  it('un admin non è vincolato dagli scope di team', async () => {
    await expect(
      createCallerWithSession(adminSession).pricing.parameterSets.list({
        brandId: outOfScopeBrandId,
        seasonId,
      })
    ).resolves.toBeInstanceOf(Array);
  });
});

describe('brand scope — collectionLayout e dashboard', () => {
  it('collectionLayout.get su un brand fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.get({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });

  it('dashboard.getSeasonProgress su un brand fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).dashboard.getSeasonProgress({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('brand scope — admin senza team', () => {
  /**
   * An admin who doesn't belong to any team must not be constrained.
   *
   * Before unification it was: `assertBrandAccess` existed in two variants,
   * and the one in `seasonCalendar.service.ts` had `userRole` as **optional**, with
   * all 15 callers omitting it. Without that parameter
   * `getUserAllowedBrandIds` never took the early return for admins,
   * so an admin with no team received `[]` → FORBIDDEN on half the seasonal
   * calendar. The fix was a hand-written `hasPermission({ role }, '*:*')`
   * at the one spot where someone had noticed.
   */
  it('seasonCalendar.getOrCreate risolve per un admin fuori da ogni team', async () => {
    await expect(
      createCallerWithSession(adminSession).seasonCalendar.getOrCreate({
        brandId: outOfScopeBrandId,
        seasonId,
      })
    ).resolves.toBeDefined();
  });

  it('un editor senza scope sul brand resta bloccato', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).seasonCalendar.getOrCreate({
          brandId: outOfScopeBrandId,
          seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('brand scope — risorse indirette', () => {
  /**
   * The procedures that don't name a brand in their input, but reach it by
   * resolving the record: layout → group → row → quotation, plus revisions
   * and the phase history. They're invisible to a check that only looks at `brandId`,
   * and they were all uncovered.
   *
   * One procedure per `it` and not grouped: `configMutations` is 20/min per
   * user, and `test/setup.ts` clears the store between tests. Grouped, they
   * would end up tripping the limit, producing a TOO_MANY_REQUESTS
   * disguised as a guard failure.
   */
  const denied: [string, () => Promise<unknown>][] = [
    ['groups.create', () =>
      as().collectionLayout.groups.create({
        collectionLayoutId: outRes.layoutId,
        data: { name: 'X', order: 0 },
      })],
    ['groups.update', () =>
      as().collectionLayout.groups.update({ groupId: outRes.groupId, data: { name: 'X' } })],
    ['groups.delete', () =>
      as().collectionLayout.groups.delete({ groupId: outRes.groupId })],
    ['rows.create', () =>
      as().collectionLayout.rows.create({
        groupId: outRes.groupId,
        gender: 'UOMO',
        line: 'X',
        status: COLLECTION_STATUS[0],
        productCategory: 'TEST',
        skuForecast: null,
        qtyForecast: null,
      })],
    ['rows.update', () =>
      as().collectionLayout.rows.update({ rowId: outRes.rowId, data: { line: 'X' } })],
    ['rows.delete', () =>
      as().collectionLayout.rows.delete({ rowId: outRes.rowId })],
    ['rows.duplicate', () =>
      as().collectionLayout.rows.duplicate({ rowId: outRes.rowId })],
    ['rows.reorder', () =>
      as().collectionLayout.rows.reorder({ groupId: outRes.groupId, orderedIds: [outRes.rowId] })],
    ['rows.setCompleted', () =>
      as().collectionLayout.rows.setCompleted({ rowId: outRes.rowId, completed: true, note: 'motivazione di test' })],
    ['rows.bulkAssignPlanningGroup', () =>
      as().collectionLayout.rows.bulkAssignPlanningGroup({
        rowIds: [outRes.rowId],
        planningGroupId: randomUUID(),
      })],
    ['quotations.create', () =>
      as().collectionLayout.quotations.create({ rowId: outRes.rowId })],
    ['quotations.update', () =>
      as().collectionLayout.quotations.update({ quotationId: outRes.quotationId, data: {} })],
    ['quotations.delete', () =>
      as().collectionLayout.quotations.delete({ quotationId: outRes.quotationId })],
    ['quotations.reorder', () =>
      as().collectionLayout.quotations.reorder({
        rowId: outRes.rowId,
        orderedIds: [outRes.quotationId],
      })],
    ['updateSettings', () =>
      as().collectionLayout.updateSettings({ collectionLayoutId: outRes.layoutId })],
    ['revision.list', () =>
      as().collectionLayoutRevision.list({ collectionLayoutId: outRes.layoutId })],
    ['revision.getDetail', () =>
      as().collectionLayoutRevision.getDetail({ revisionId: outRes.revisionId })],
    ['revision.getLayoutAsOf', () =>
      as().collectionLayoutRevision.getLayoutAsOf({
        collectionLayoutId: outRes.layoutId,
        revisionId: outRes.revisionId,
      })],
    // `collectionLayoutId` is no longer an input: if it reappeared, this line wouldn't
    // compile. This is the test that counts for the cross-layout case — the runtime can
    // no longer express the inconsistency.
    ['revision.export.xlsx', () =>
      as().collectionLayoutRevision.export.xlsx({ revisionId: outRes.revisionId })],
    ['phaseHistory.listForRow', () =>
      as().phaseHistory.listForRow({ rowId: outRes.rowId })],
    ['phaseHistory.layoutStats', () =>
      as().phaseHistory.layoutStats({ collectionLayoutId: outRes.layoutId })],
    ['phaseHistory.completionLeadTime', () =>
      as().phaseHistory.completionLeadTime({ collectionLayoutId: outRes.layoutId })],
  ];

  const as = () => createCallerWithSession(scopedSession);

  it.each(denied)('%s su una risorsa fuori scope → FORBIDDEN', async (_label, invoke) => {
    await expectUnauthorized(invoke, 'FORBIDDEN');
  });

  it('un id inesistente è NOT_FOUND, non FORBIDDEN', async () => {
    // Order matters: an id that doesn't exist isn't a permissions problem, and
    // responding FORBIDDEN would tell the attacker that something exists.
    await expect(
      as().collectionLayout.groups.delete({ groupId: randomUUID() })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('la stessa procedura sul brand in scope non è bloccata', async () => {
    await expect(
      as().phaseHistory.layoutStats({ collectionLayoutId: inRes.layoutId })
    ).resolves.toBeInstanceOf(Array);
  });

  it('anche sulle risorse indirette in scope', async () => {
    await expect(
      as().phaseHistory.listForRow({ rowId: inRes.rowId })
    ).resolves.toBeInstanceOf(Array);
  });
});

describe('brand scope — copyFromSeason', () => {
  /**
   * **Both** guards are needed, and a table testing only one direction wouldn't
   * catch it: with only the source check, you write into a brand you don't
   * own; with only the destination check, you read another brand's collection
   * by cloning it into your own.
   */
  it('sorgente fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.copyFromSeason({
          fromBrandId: outOfScopeBrandId,
          fromSeasonId: seasonId,
          toBrandId: inScopeBrandId,
          toSeasonId: seasonId,
        }),
      'FORBIDDEN'
    );
  });

  it('destinazione fuori scope → FORBIDDEN', async () => {
    await expectUnauthorized(
      () =>
        createCallerWithSession(scopedSession).collectionLayout.copyFromSeason({
          fromBrandId: inScopeBrandId,
          fromSeasonId: seasonId,
          toBrandId: outOfScopeBrandId,
          toSeasonId: seasonId,
        }),
      'FORBIDDEN'
    );
  });
});

describe('reorder — gli id devono appartenere al parent', () => {
  /**
   * A different class of bug from brand scope, found alongside it. `reorder` took the
   * list of ids and ran `update({ where: { id } })` on each, without filtering
   * on the parent: a legitimate `rowId` was enough to reorder another user's row's
   * quotations. The brand guard doesn't catch it, because the `rowId` passed
   * really is yours.
   */
  it('una quotazione di un\'altra riga non viene toccata', async () => {
    const asAdmin = createCallerWithSession(adminSession);

    // Two distinct rows, each with its own quotation.
    const mine = await asAdmin.collectionLayout.rows.create({
      groupId: outRes.groupId,
      gender: 'UOMO',
      line: 'Mia',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    const mineQuotation = await asAdmin.collectionLayout.quotations.create({
      rowId: mine.id,
    });
    const foreignQuotation = await asAdmin.collectionLayout.quotations.create({
      rowId: outRes.rowId,
    });

    const before = await prisma.collectionRowQuotation.findUnique({
      where: { id: foreignQuotation.id },
      select: { order: true, rowId: true },
    });

    // Reordering "my" row, but slipping the other user's quotation into the list at
    // position 0 — which is what would change its order.
    await asAdmin.collectionLayout.quotations.reorder({
      rowId: mine.id,
      orderedIds: [foreignQuotation.id, mineQuotation.id],
    });

    const after = await prisma.collectionRowQuotation.findUnique({
      where: { id: foreignQuotation.id },
      select: { order: true, rowId: true },
    });

    expect(after).toEqual(before);
  });
});
