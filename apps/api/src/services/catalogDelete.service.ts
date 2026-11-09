/**
 * Permanent deletion of a brand or season: what still references one, the answer when it is
 * refused, and the purge that deletes a test brand or season with everything under it.
 */

import { TRPCError } from '@trpc/server';

import { Prisma, type PrismaClient } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { FOREIGN_KEYS, isForeignKeyViolation } from '../lib/error.js';
import { deleteObjectByKey } from '../storage';

import { deleteGoogleCalendars, deleteGoogleCopies } from './googleCalendarSync.service';

import type { Context } from '../lib/context.js';

/** A brand's or a season's rows, by the column that references it. */
export type CatalogScope = { brandId: string } | { seasonId: string };

/**
 * The `Restrict` foreign keys onto a brand or season: each refuses its delete. A test reads them
 * from the database, so a new one fails it until it is counted here.
 */
export const REFERENCE_KEYS = [
  FOREIGN_KEYS.layoutBrand,
  FOREIGN_KEYS.layoutSeason,
  FOREIGN_KEYS.parameterSetBrand,
  FOREIGN_KEYS.parameterSetSeason,
  FOREIGN_KEYS.calendarBrand,
  FOREIGN_KEYS.calendarSeason,
  FOREIGN_KEYS.merchPlanBrand,
  FOREIGN_KEYS.merchPlanSeason,
] as const;

/** How many rows of each kind reference the brand or season, labelled as the refusal shows them. */
async function countReferences(prisma: PrismaClient, where: CatalogScope) {
  const [layouts, parameterSets, calendars, merchandisingPlans] = await Promise.all([
    prisma.collectionLayout.count({ where }),
    prisma.pricingParameterSet.count({ where }),
    prisma.seasonCalendar.count({ where }),
    prisma.merchandisingPlan.count({ where }),
  ]);
  return {
    'collection layout': layouts,
    'set di pricing': parameterSets,
    calendari: calendars,
    'piani merchandising': merchandisingPlans,
  };
}

function refusal(subject: string, counts: Record<string, number>): TRPCError {
  const used = Object.entries(counts).filter(([, n]) => n > 0).map(([label, n]) => `${label} (${n})`);
  // A reference that refused the delete and was removed before the recount leaves nothing to name.
  if (used.length === 0) {
    return new TRPCError({ code: 'CONFLICT', message: 'I dati collegati sono cambiati nel frattempo: riprova' });
  }
  return new TRPCError({ code: 'PRECONDITION_FAILED', message: `${subject} da ${used.join(', ')}` });
}

/**
 * Refuses while anything references the brand or season.
 *
 * @param subject - The refusal's opening, e.g. "Impossibile eliminare: il brand è ancora usato".
 * @throws {TRPCError} PRECONDITION_FAILED, naming what references it.
 */
export async function assertUnreferenced(prisma: PrismaClient, where: CatalogScope, subject: string): Promise<void> {
  const counts = await countReferences(prisma, where);
  if (Object.values(counts).some(n => n > 0)) throw refusal(subject, counts);
}

/**
 * Runs `remove` once nothing references the brand or season. A reference created after the check
 * makes the database refuse the delete: that refusal gets the check's answer, counted again.
 *
 * @param subject - As for {@link assertUnreferenced}.
 * @throws {TRPCError} PRECONDITION_FAILED, naming what references it; CONFLICT if the reference that
 *   refused the delete is gone by the recount.
 */
export async function deleteUnreferenced<T>(
  prisma: PrismaClient,
  where: CatalogScope,
  subject: string,
  remove: () => Promise<T>
): Promise<T> {
  await assertUnreferenced(prisma, where, subject);
  try {
    return await remove();
  } catch (err) {
    if (!isForeignKeyViolation(err, ...REFERENCE_KEYS)) throw err;
    throw refusal(subject, await countReferences(prisma, where));
  }
}

// ─────────────────────────────────────────────────────────────────
// Purge: a test brand or season, with everything under it
// ─────────────────────────────────────────────────────────────────

export type PurgeKind = 'brand' | 'season';

/** How long a purge may hold its locks before it is abandoned, whole. */
const PURGE_TIMEOUT_MS = 60_000;

const ENTITY = {
  brand: {
    table: 'brands', column: 'brandId', label: 'il brand', action: 'BRAND_PURGE', targetType: 'Brand',
    navLinked: 'Impossibile eliminare il brand con i suoi dati: è collegato a NAV',
    active: 'Disattiva prima il brand, poi eliminalo con i suoi dati',
  },
  season: {
    table: 'seasons', column: 'seasonId', label: 'la stagione', action: 'SEASON_PURGE', targetType: 'Season',
    navLinked: 'Impossibile eliminare la stagione con i suoi dati: è collegata a NAV',
    active: 'Disattiva prima la stagione, poi eliminala con i suoi dati',
  },
} as const;

type Db = PrismaClient | Prisma.TransactionClient;

const scopeOf = (kind: PurgeKind, id: string): CatalogScope => (kind === 'brand' ? { brandId: id } : { seasonId: id });

/** The entity, refused unless a purge may take it: inactive, with no NAV link. */
async function purgeable(db: Db, kind: PurgeKind, id: string) {
  const e = ENTITY[kind];
  const entity =
    kind === 'brand'
      ? await db.brand.findUnique({ where: { id }, select: { name: true, isActive: true, navBrandId: true, logoKey: true } })
      : await db.season.findUnique({ where: { id }, select: { name: true, isActive: true, navSeasonId: true } });
  if (!entity) {
    throw new TRPCError({ code: 'NOT_FOUND', message: kind === 'brand' ? 'Brand non trovato' : 'Stagione non trovata' });
  }
  const navLinked = 'navBrandId' in entity ? entity.navBrandId !== null : entity.navSeasonId !== null;
  if (navLinked) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: e.navLinked });
  }
  if (entity.isActive) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: e.active });
  }
  return { name: entity.name, logoKey: 'logoKey' in entity ? entity.logoKey : null };
}

/**
 * Locks what the purge reads keys and mappings from, so nothing is added to it before the commit:
 * the containers (a new group, row, plan row, specsheet or binding waits on their foreign key
 * check), then the rows that hold files or Google copies. A fixed order, so two purges never wait on
 * each other in a cycle.
 * Raw SQL exception: row locks, which the ORM cannot express, inside an interactive transaction.
 */
async function lockSubtree(tx: Prisma.TransactionClient, kind: PurgeKind, id: string) {
  // nosemgrep: luke-prisma-raw-fragment -- the column is a constant of ENTITY, never taken from a caller
  const column = Prisma.raw(`"${ENTITY[kind].column}"`);
  const ids = async (table: 'collection_layouts' | 'merchandising_plans' | 'season_calendars') =>
    (await tx.$queryRaw<{ id: string }[]>(
      // nosemgrep: luke-prisma-raw-fragment -- the table is one of three literal names, typed above
      Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE ${column} = ${id} ORDER BY id FOR UPDATE`
    )).map(r => r.id);
  const layoutIds = await ids('collection_layouts');
  const planIds = await ids('merchandising_plans');
  const calendarIds = await ids('season_calendars');
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM collection_layout_rows WHERE "collectionLayoutId" = ANY(${layoutIds}::text[]) ORDER BY id FOR UPDATE
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM merchandising_plan_rows WHERE "planId" = ANY(${planIds}::text[]) ORDER BY id FOR UPDATE
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM merchandising_specsheets s JOIN merchandising_plan_rows r ON r.id = s."rowId"
    WHERE r."planId" = ANY(${planIds}::text[]) ORDER BY s.id FOR UPDATE OF s
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM merchandising_images i JOIN merchandising_specsheets s ON s.id = i."specsheetId"
    JOIN merchandising_plan_rows r ON r.id = s."rowId"
    WHERE r."planId" = ANY(${planIds}::text[]) ORDER BY i.id FOR UPDATE OF i
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM calendar_events WHERE "calendarId" = ANY(${calendarIds}::text[]) ORDER BY id FOR UPDATE
  `);
  // A sync that provisions a binding meanwhile waits, then finds it gone: its new Google calendar
  // is the one copy a purge can leave behind.
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM google_calendar_bindings WHERE "seasonCalendarId" = ANY(${calendarIds}::text[]) ORDER BY id FOR UPDATE
  `);
  return { layoutIds, planIds, calendarIds };
}

type Subtree = { layoutIds: string[]; planIds: string[]; calendarIds: string[] };

/** What a purge of the subtree deletes, keeps and is refused by. */
async function census(db: Db, kind: PurgeKind, id: string, { layoutIds, planIds, calendarIds }: Subtree) {
  const scope = scopeOf(kind, id);
  const inLayouts = { in: layoutIds };
  const inCalendars = { in: calendarIds };
  const [
    groups, rows, quotations, revisions, keptPictureReferences, planningGroups, events,
    merchandisingRows, images, parameterSets, cascaded, googleCopies, googleCalendars,
    outsideRows, outsideEvents, outsideQuotations, outsideMerchandisingRows,
  ] = await Promise.all([
    db.collectionGroup.count({ where: { collectionLayoutId: inLayouts } }),
    db.collectionLayoutRow.findMany({ where: { collectionLayoutId: inLayouts }, select: { pictureKey: true } }),
    db.collectionRowQuotation.count({ where: { row: { collectionLayoutId: inLayouts } } }),
    db.collectionLayoutRevision.count({ where: { collectionLayoutId: inLayouts } }),
    db.collectionLayoutRowRevision.count({ where: { pictureKey: { not: null }, revision: { collectionLayoutId: inLayouts } } }),
    db.planningGroup.count({ where: { calendarId: inCalendars } }),
    db.calendarEvent.count({ where: { calendarId: inCalendars } }),
    db.merchandisingPlanRow.count({ where: { planId: { in: planIds } } }),
    db.merchandisingImage.findMany({ where: { specsheet: { row: { planId: { in: planIds } } } }, select: { key: true } }),
    db.pricingParameterSet.count({ where: scope }),
    kind === 'brand'
      ? db.companyTeamBrandScope.count({ where: { brandId: id } })
      : db.vendorClosurePeriod.count({ where: { seasonId: id } }),
    db.googleEventMapping.findMany({
      where: { event: { calendarId: inCalendars } },
      select: { googleCalendarId: true, googleEventId: true },
    }),
    db.googleCalendarBinding.findMany({
      where: { seasonCalendarId: inCalendars, isProvisioned: true },
      select: { googleCalendarId: true },
    }),
    db.collectionLayoutRow.count({ where: { planningGroup: { calendarId: inCalendars }, collectionLayoutId: { notIn: layoutIds } } }),
    db.calendarEvent.count({ where: { planningGroup: { calendarId: inCalendars }, calendarId: { notIn: calendarIds } } }),
    db.collectionRowQuotation.count({ where: { pricingParameterSet: scope, row: { collectionLayoutId: { notIn: layoutIds } } } }),
    db.merchandisingPlanRow.count({ where: { pricingParameterSet: scope, planId: { notIn: planIds } } }),
  ]);
  return {
    deletedCounts: {
      layouts: layoutIds.length,
      groups,
      rows: rows.length,
      quotations,
      revisions,
      calendars: calendarIds.length,
      planningGroups,
      events,
      merchandisingPlans: planIds.length,
      merchandisingRows,
      parameterSets,
      // Named keys, not a computed one, which would widen the type the web's label map is keyed by.
      teamBrandScopes: kind === 'brand' ? cascaded : undefined,
      vendorClosures: kind === 'season' ? cascaded : undefined,
    },
    keptPictureReferences,
    outside: { rows: outsideRows, events: outsideEvents, quotations: outsideQuotations, merchandisingRows: outsideMerchandisingRows },
    pictureKeys: rows.flatMap(r => (r.pictureKey ? [r.pictureKey] : [])),
    imageKeys: images.flatMap(i => (i.key ? [i.key] : [])),
    googleCopies,
    googleCalendarIds: googleCalendars.map(b => b.googleCalendarId),
  };
}

function refuseOutside(kind: PurgeKind, outside: Awaited<ReturnType<typeof census>>['outside']) {
  if (Object.values(outside).every(n => n === 0)) return;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      `Impossibile eliminare ${ENTITY[kind].label} con i suoi dati: altri brand o stagioni usano i suoi gruppi di ` +
      `pianificazione o set di pricing (righe ${outside.rows + outside.merchandisingRows}, eventi ${outside.events}, ` +
      `quotazioni ${outside.quotations})`,
  });
}

/**
 * What a purge of an inactive, NAV-free brand or season would delete: counts, the other brands or
 * seasons whose data goes with it, the revision pictures kept, and references from outside that
 * would refuse it. Not authoritative: the purge counts again under its locks.
 *
 * @throws {TRPCError} NOT_FOUND, BAD_REQUEST (linked to NAV) or PRECONDITION_FAILED (still active).
 */
export async function previewPurge(prisma: PrismaClient, kind: PurgeKind, id: string) {
  const { name } = await purgeable(prisma, kind, id);
  const scope = scopeOf(kind, id);
  const select = { id: true, brandId: true, seasonId: true } as const;
  const [layouts, plans, calendars, sets] = await Promise.all([
    prisma.collectionLayout.findMany({ where: scope, select }),
    prisma.merchandisingPlan.findMany({ where: scope, select }),
    prisma.seasonCalendar.findMany({ where: scope, select }),
    prisma.pricingParameterSet.findMany({ where: scope, select }),
  ]);
  const { deletedCounts, keptPictureReferences, outside } = await census(prisma, kind, id, {
    layoutIds: layouts.map(l => l.id),
    planIds: plans.map(p => p.id),
    calendarIds: calendars.map(c => c.id),
  });
  // The other dimension: the seasons a brand's data spans, or the brands a season's data spans.
  const otherIds = [...new Set([...layouts, ...plans, ...calendars, ...sets].map(r => (kind === 'brand' ? r.seasonId : r.brandId)))];
  const involved =
    kind === 'brand'
      ? await prisma.season.findMany({ where: { id: { in: otherIds } }, select: { name: true }, orderBy: { name: 'asc' } })
      : await prisma.brand.findMany({ where: { id: { in: otherIds } }, select: { name: true }, orderBy: { name: 'asc' } });
  return { name, counts: deletedCounts, involved: involved.map(i => i.name), keptPictureReferences, outside };
}

/**
 * Deletes an inactive, NAV-free brand or season with everything under it: merchandising plans,
 * layout revisions, layouts, events, calendars, parameter sets, their edit locks, then the entity.
 * One transaction holds the guards and the subtree locked to the commit, and records one audit
 * entry with what it deleted; a failure anywhere deletes nothing. A season's data goes for every brand.
 *
 * After the commit, each on its own and logged when it fails: the stored files no surviving record
 * names (logo, row pictures, merchandising images), the Google copies of the events and the Google
 * calendars Luke provisioned. Revision pictures stay: the immutable register deduplicates them
 * across brands (`copyToImmutableBucket`), so the audit counts the references kept.
 *
 * @throws {TRPCError} NOT_FOUND; BAD_REQUEST (linked to NAV, or the name does not match);
 *   PRECONDITION_FAILED (still active, or referenced from outside); CONFLICT (a reference changed
 *   during the purge); TIMEOUT (past `PURGE_TIMEOUT_MS`).
 */
export async function purge(ctx: Context, kind: PurgeKind, id: string, confirmName: string) {
  const e = ENTITY[kind];
  let result;
  try {
    result = await ctx.prisma.$transaction(async tx => {
      // Raw SQL exception: a row lock, which the ORM cannot express, inside an interactive
      // transaction. Taken before the guards, so they hold to the commit; FOR UPDATE also makes a new
      // layout, calendar, plan or set wait on its foreign key check.
      // nosemgrep: luke-prisma-raw-fragment -- the table is a constant of ENTITY, never taken from a caller
      await tx.$queryRaw(Prisma.sql`SELECT 1 FROM ${Prisma.raw(e.table)} WHERE id = ${id} FOR UPDATE`);
      const { name, logoKey } = await purgeable(tx, kind, id);
      if (confirmName !== name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il nome digitato non corrisponde' });
      }
      const subtree = await lockSubtree(tx, kind, id);
      const found = await census(tx, kind, id, subtree);
      refuseOutside(kind, found.outside);

      await tx.merchandisingPlan.deleteMany({ where: { id: { in: subtree.planIds } } });
      await tx.collectionLayoutRevision.deleteMany({ where: { collectionLayoutId: { in: subtree.layoutIds } } });
      await tx.collectionLayout.deleteMany({ where: { id: { in: subtree.layoutIds } } });
      // Events before their calendar: they hold its planning groups (`Restrict`). The freeze rule
      // guards a live calendar's events; here the whole calendar goes.
      await tx.calendarEvent.deleteMany({ where: { calendarId: { in: subtree.calendarIds } } });
      await tx.seasonCalendar.deleteMany({ where: { id: { in: subtree.calendarIds } } });
      await tx.pricingParameterSet.deleteMany({ where: scopeOf(kind, id) });
      await tx.editLock.deleteMany({
        where: {
          OR: [
            { entityType: 'COLLECTION_LAYOUT', entityId: { in: subtree.layoutIds } },
            { entityType: 'SEASON_CALENDAR', entityId: { in: subtree.calendarIds } },
          ],
        },
      });
      if (kind === 'brand') await tx.brand.delete({ where: { id } });
      else await tx.season.delete({ where: { id } });

      // A key another record still names (a legacy revision's live key) stays stored.
      const [rowKeys, revisionKeys, imageKeys] = await Promise.all([
        tx.collectionLayoutRow.findMany({ where: { pictureKey: { in: found.pictureKeys } }, select: { pictureKey: true } }),
        tx.collectionLayoutRowRevision.findMany({ where: { pictureKey: { in: found.pictureKeys } }, select: { pictureKey: true } }),
        tx.merchandisingImage.findMany({ where: { key: { in: found.imageKeys } }, select: { key: true } }),
      ]);
      const stillNamed = new Set([...rowKeys, ...revisionKeys].map(r => r.pictureKey));
      const stillNamedImages = new Set(imageKeys.map(i => i.key));
      const deletedCalendars = new Set(found.googleCalendarIds);

      // A critical action: a failed write throws, rolling the purge back.
      await logAudit(ctx, {
        action: e.action,
        targetType: e.targetType,
        targetId: id,
        result: 'SUCCESS',
        metadata: { name, deletedCounts: found.deletedCounts, keptPictureReferences: found.keptPictureReferences },
      }, { tx });
      return {
        deletedCounts: found.deletedCounts,
        keptPictureReferences: found.keptPictureReferences,
        files: [
          ...(logoKey ? [{ bucket: 'brand-logos' as const, key: logoKey }] : []),
          ...found.pictureKeys.filter(k => !stillNamed.has(k)).map(key => ({ bucket: 'collection-row-pictures' as const, key })),
          ...found.imageKeys.filter(k => !stillNamedImages.has(k)).map(key => ({ bucket: 'merchandising-specsheet-images' as const, key })),
        ],
        // Copies inside a calendar it deletes go with that calendar.
        googleCopies: found.googleCopies.filter(c => !deletedCalendars.has(c.googleCalendarId)),
        googleCalendarIds: found.googleCalendarIds,
      };
    }, { timeout: PURGE_TIMEOUT_MS });
  } catch (err) {
    throw purgeFailure(err) ?? err;
  }

  await cleanUpAfterPurge(ctx, result);
  return { deletedCounts: result.deletedCounts, keptPictureReferences: result.keptPictureReferences };
}

/** The answer to a purge the database refused, or `null` to rethrow. */
function purgeFailure(err: unknown): TRPCError | null {
  if (
    isForeignKeyViolation(
      err,
      FOREIGN_KEYS.rowPlanningGroup,
      FOREIGN_KEYS.eventPlanningGroup,
      FOREIGN_KEYS.quotationParameterSet,
      FOREIGN_KEYS.merchRowParameterSet
    )
  ) {
    return new TRPCError({ code: 'CONFLICT', message: 'Dati collegati cambiati durante l\'eliminazione, che è stata annullata: riprova' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
    return new TRPCError({ code: 'CONFLICT', message: 'Eliminazione in conflitto con un\'altra modifica, annullata: riprova' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') {
    return new TRPCError({ code: 'TIMEOUT', message: 'Il database non ha completato l\'eliminazione in tempo, che è stata annullata: riprova' });
  }
  return null;
}

/**
 * Best effort, after the commit: a failure here leaves an orphan and a log line, never a failed
 * purge, and never stops the next item. Exported for its unit test.
 */
export async function cleanUpAfterPurge(
  ctx: Context,
  leftovers: {
    files: { bucket: 'brand-logos' | 'collection-row-pictures' | 'merchandising-specsheet-images'; key: string }[];
    googleCopies: { googleCalendarId: string; googleEventId: string }[];
    googleCalendarIds: string[];
  }
) {
  for (const file of leftovers.files) {
    try {
      await deleteObjectByKey(ctx, file);
    } catch (err) {
      ctx.logger.warn({ err, ...file }, 'Purge: stored file left behind');
    }
  }
  try {
    await deleteGoogleCopies(leftovers.googleCopies, ctx.prisma, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, count: leftovers.googleCopies.length }, 'Purge: Google event copies left behind');
  }
  try {
    await deleteGoogleCalendars(leftovers.googleCalendarIds, ctx.prisma, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, count: leftovers.googleCalendarIds.length }, 'Purge: Google calendars left behind');
  }
}
