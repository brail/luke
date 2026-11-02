/**
 * Permanent deletion of a brand or season: what still references one, and the answer when it is
 * refused.
 */

import { TRPCError } from '@trpc/server';

import type { PrismaClient } from '@luke/db';

import { FOREIGN_KEYS, isForeignKeyViolation } from '../lib/error.js';

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
