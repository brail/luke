/**
 * Pricing service — price calculation engine and parameter set CRUD.
 * Calculation functions are pure (no I/O). CRUD functions receive PrismaClient as their last argument.
 */

import { TRPCError } from '@trpc/server';

import {
  calcMaxSupplierCost,
  calculateCompanyMultiplier,
  isInPricingRange,
  priceForward,
  priceInverse,
  priceMargin,
  retailMargin,
  suggestRetailPrice,
  type PricingParameterSetInput,
} from '@luke/core';
import { Prisma } from '@luke/db';
import type { PrismaClient, PricingParameterSet } from '@luke/db';

import { FOREIGN_KEYS, isForeignKeyViolation, isUniqueViolation } from '../lib/error';

// ─────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────

export interface CalcParams {
  qualityControlPercent: number;
  transportInsuranceCost: number;
  duty: number;
  exchangeRate: number;
  italyAccessoryCosts: number;
  tools: number;
  retailMultiplier: number;
  optimalMargin: number;
  purchaseCurrency: string;
  sellingCurrency: string;
}

export interface ForwardResult {
  mode: 'forward';
  purchasePrice: number;
  qualityControlCost: number;
  priceWithQC: number;
  transportInsuranceCost: number;
  priceWithTransport: number;
  dutyCost: number;
  priceWithDuty: number;
  italyAccessoryCosts: number;
  landedCost: number;
  companyMultiplier: number;
  wholesalePrice: number;
  retailPriceRaw: number;
  retailPrice: number;
  companyMargin: number;
  purchaseCurrency: string;
  sellingCurrency: string;
}

export interface InverseResult {
  mode: 'inverse';
  retailPrice: number;
  wholesalePrice: number;
  landedCost: number;
  priceWithoutAccessories: number;
  dutyCost: number;
  priceWithoutDuty: number;
  priceWithoutTransport: number;
  qualityControlCost: number;
  purchasePriceRaw: number;
  purchasePrice: number;
  companyMargin: number;
  purchaseCurrency: string;
  sellingCurrency: string;
}

export interface MarginResult {
  mode: 'margin';
  purchasePrice: number;
  retailPrice: number;
  landedCost: number;
  wholesalePrice: number;
  companyMargin: number;
  companyMultiplier: number;
  purchaseCurrency: string;
  sellingCurrency: string;
}

// ─────────────────────────────────────────────────────────────────
// Pure calculation formulas
// ─────────────────────────────────────────────────────────────────

/**
 * Forward calculation: given a purchase price, computes the retail price through
 * QC → tools → transport → duty → currency conversion → landed cost → wholesale → retail
 * (`priceForward`).
 *
 * @returns Breakdown of every intermediate step plus the suggested retail price (the first
 *   commercial threshold whose margin reaches the target, `suggestRetailPrice`), and the margin that
 *   price leaves over the purchase price.
 * @throws {TRPCError} BAD_REQUEST if the raw retail price is out of the range the proposal accepts.
 */
export function calculateForward(
  purchasePrice: number,
  params: CalcParams
): ForwardResult {
  const f = priceForward(purchasePrice, params);
  if (!isInPricingRange(f.retailPriceRaw)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Prezzo di acquisto fuori dall'intervallo calcolabile",
    });
  }
  const retailPrice = suggestRetailPrice(purchasePrice, params);

  return {
    mode: 'forward',
    purchasePrice,
    qualityControlCost: round2(f.qualityControlCost),
    priceWithQC: round2(f.priceWithQC),
    transportInsuranceCost: params.transportInsuranceCost,
    priceWithTransport: round2(f.priceWithTransport),
    dutyCost: round2(f.dutyCost),
    priceWithDuty: round2(f.priceWithDuty),
    italyAccessoryCosts: params.italyAccessoryCosts,
    landedCost: round2(f.landedCost),
    companyMultiplier: f.companyMultiplier,
    wholesalePrice: round2(f.wholesalePrice),
    retailPriceRaw: ceil2(f.retailPriceRaw),
    retailPrice,
    companyMargin: retailMargin(purchasePrice, retailPrice, params),
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

/**
 * Inverse calculation: given a retail price, computes the maximum allowable purchase price
 * while maintaining the target margin (`priceInverse`).
 *
 * @returns Breakdown of every intermediate step plus the maximum purchase price (the largest tenth
 *   whose margin reaches the target, `calcMaxSupplierCost`), and the margin the retail price leaves
 *   over it.
 * @throws {TRPCError} BAD_REQUEST if the retail price does not cover the fixed costs (not even 0.1
 *   reaches the target), or if the raw purchase price is out of the range the proposal accepts.
 */
export function calculateInverse(
  retailPrice: number,
  params: CalcParams
): InverseResult {
  const i = priceInverse(retailPrice, params);
  const purchasePrice = calcMaxSupplierCost(retailPrice, params);
  if (purchasePrice === null) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: isInPricingRange(i.purchasePriceRaw)
        ? 'Il prezzo retail non copre i costi fissi: nessun prezzo di acquisto lo raggiunge'
        : "Prezzo retail fuori dall'intervallo calcolabile",
    });
  }

  return {
    mode: 'inverse',
    retailPrice,
    wholesalePrice: round2(i.wholesalePrice),
    landedCost: round2(i.landedCost),
    priceWithoutAccessories: round2(i.priceWithoutAccessories),
    dutyCost: round2(i.dutyCost),
    priceWithoutDuty: round2(i.priceWithoutDuty),
    priceWithoutTransport: round2(i.priceWithoutTransport),
    qualityControlCost: round2(i.qualityControlCost),
    purchasePriceRaw: floor2(i.purchasePriceRaw),
    purchasePrice,
    companyMargin: retailMargin(purchasePrice, retailPrice, params),
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

/**
 * Margin-only calculation: given both purchase and retail prices, computes the actual
 * company margin without rounding either input — the landed cost forward from the purchase
 * price, the wholesale backward from the retail price.
 */
export function calculateMarginOnly(
  purchasePrice: number,
  retailPrice: number,
  params: CalcParams
): MarginResult {
  const m = priceMargin(purchasePrice, retailPrice, params);

  return {
    mode: 'margin',
    purchasePrice,
    retailPrice,
    landedCost: round2(m.landedCost),
    wholesalePrice: round2(m.wholesalePrice),
    companyMargin: m.companyMargin,
    companyMultiplier: calculateCompanyMultiplier(params.optimalMargin),
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

/**
 * Presentation rounding of a money amount. Margins are left unrounded: views classify them with
 * `classifyMargin` before rounding them for display.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A raw price shown above its proposal, to the cent in the proposal's direction (retail up, purchase
 * down): a raw BT of 48.398 reads 48.39 above a BT of 48.3, not 48.40. Display only; the 1e-6 cent
 * absorbs float noise on an exact cent.
 */
function ceil2(value: number): number {
  return Math.ceil(value * 100 - 1e-6) / 100;
}

function floor2(value: number): number {
  return Math.floor(value * 100 + 1e-6) / 100;
}

// ─────────────────────────────────────────────────────────────────
// CRUD functions
// ─────────────────────────────────────────────────────────────────

/**
 * Returns all pricing parameter sets for a brand+season ordered by orderIndex then createdAt.
 */
export async function getParameterSets(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<PricingParameterSet[]> {
  return prisma.pricingParameterSet.findMany({
    where: { brandId, seasonId },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Finds parameter sets from the most recent season (by year) that has data for the brand,
 * excluding the current season. Used by the "copy from previous season" feature.
 *
 * @returns The previous season metadata and its full set list, or null if none exists.
 */
export async function getPreviousSeasonSets(
  brandId: string,
  currentSeasonId: string,
  prisma: PrismaClient
): Promise<{
  season: { id: string; code: string; year: number | null; name: string };
  sets: PricingParameterSet[];
} | null> {
  // Find the current season to compare year
  const currentSeason = await prisma.season.findUnique({
    where: { id: currentSeasonId },
    select: { year: true, code: true },
  });

  if (!currentSeason) return null;

  // Find brand+seasons with parameters, excluding the current season, ordered by year desc
  const previousEntry = await prisma.pricingParameterSet.findFirst({
    where: {
      brandId,
      seasonId: { not: currentSeasonId },
    },
    include: {
      season: {
        select: { id: true, code: true, year: true, name: true },
      },
    },
    orderBy: {
      season: { year: 'desc' },
    },
  });

  if (!previousEntry) return null;

  // Load all sets for that season
  const sets = await prisma.pricingParameterSet.findMany({
    where: { brandId, seasonId: previousEntry.seasonId },
    orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
  });

  return { season: previousEntry.season, sets };
}

/**
 * Serializes every writer of one brand+season's default flag — create, set-default, delete — so
 * "exactly one default while the scope holds sets" survives concurrent requests: each decides on
 * what it reads after taking the lock. Scoped to the transaction, released on commit or rollback.
 * Raw SQL because the Prisma ORM has no advisory locks — the `acquireLastAdminLock` pattern.
 */
async function lockDefaultSet(tx: Prisma.TransactionClient, brandId: string, seasonId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pricing-default-set:${brandId}:${seasonId}`}))`;
}

/**
 * Atomically marks one parameter set as default and clears the flag on all others
 * in the same brand+season scope, under the scope's lock (`lockDefaultSet`).
 *
 * @throws {TRPCError} NOT_FOUND if the parameter set does not belong to the given brand+season.
 */
export async function setAsDefault(
  id: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<PricingParameterSet> {
  const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Set parametri non trovato' });
  return prisma.$transaction(
    async tx => {
      await lockDefaultSet(tx, brandId, seasonId);
      // Remove default from all others
      await tx.pricingParameterSet.updateMany({
        where: { brandId, seasonId, NOT: { id } },
        data: { isDefault: false },
      });
      // Conditional: a set deleted meanwhile (a purge takes no lock of this scope) is not found.
      const { count } = await tx.pricingParameterSet.updateMany({
        where: { id, brandId, seasonId },
        data: { isDefault: true },
      });
      if (count === 0) throw notFound();
      return tx.pricingParameterSet.findUniqueOrThrow({ where: { id } });
    },
    // Stated rather than inherited: each read after the lock must see what the previous holder committed.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

/**
 * Creates a new pricing parameter set. Automatically marks it as default if it is the
 * first set for the given brand+season, counting under the scope's lock (`lockDefaultSet`).
 *
 * @throws {TRPCError} NOT_FOUND if the brand or season does not exist.
 * @throws {TRPCError} CONFLICT if a set with the same name already exists for this brand+season.
 */
export async function createParameterSet(
  brandId: string,
  seasonId: string,
  input: PricingParameterSetInput,
  prisma: PrismaClient
): Promise<PricingParameterSet> {
  return prisma.$transaction(
    async tx => {
      await lockDefaultSet(tx, brandId, seasonId);
      // The first set of a brand+season becomes its default; a new one goes after the last.
      const { _count, _max } = await tx.pricingParameterSet.aggregate({
        where: { brandId, seasonId },
        _count: true,
        _max: { orderIndex: true },
      });

      // The unique (brand, season, name) and the foreign keys answer a taken name or a missing
      // brand or season.
      return tx.pricingParameterSet
        .create({
          data: {
            brandId,
            seasonId,
            name: input.name,
            countryCode: input.countryCode,
            purchaseCurrency: input.purchaseCurrency,
            sellingCurrency: input.sellingCurrency,
            qualityControlPercent: input.qualityControlPercent,
            transportInsuranceCost: input.transportInsuranceCost,
            duty: input.duty,
            exchangeRate: input.exchangeRate,
            italyAccessoryCosts: input.italyAccessoryCosts,
            tools: input.tools,
            retailMultiplier: input.retailMultiplier,
            optimalMargin: input.optimalMargin,
            isDefault: _count === 0,
            orderIndex: (_max.orderIndex ?? -1) + 1,
          },
        })
        .catch((err: unknown) => {
          if (isUniqueViolation(err, 'pricing_parameter_sets_brandId_seasonId_name_key')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Esiste già una variante con nome "${input.name}" per questa combinazione brand+stagione`,
            });
          }
          if (isForeignKeyViolation(err, FOREIGN_KEYS.parameterSetBrand)) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
          }
          if (isForeignKeyViolation(err, FOREIGN_KEYS.parameterSetSeason)) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
          }
          throw err;
        });
    },
    // Stated rather than inherited: the count after the lock must see what the previous holder committed.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

/**
 * Updates an existing pricing parameter set.
 *
 * @throws {TRPCError} NOT_FOUND if the set does not belong to the given brand+season.
 * @throws {TRPCError} CONFLICT if the new name conflicts with another set in the same scope.
 */
export async function updateParameterSet(
  id: string,
  brandId: string,
  seasonId: string,
  input: PricingParameterSetInput,
  prisma: PrismaClient
): Promise<PricingParameterSet> {
  const existing = await prisma.pricingParameterSet.findFirst({
    where: { id, brandId, seasonId },
  });

  if (!existing) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Set parametri non trovato',
    });
  }

  // Check name uniqueness (excludes itself)
  if (input.name !== existing.name) {
    const conflict = await prisma.pricingParameterSet.findUnique({
      where: { brandId_seasonId_name: { brandId, seasonId, name: input.name } },
    });
    if (conflict) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Esiste già una variante con nome "${input.name}" per questa combinazione brand+stagione`,
      });
    }
  }

  return prisma.pricingParameterSet.update({
    where: { id },
    data: {
      name: input.name,
      countryCode: input.countryCode,
      purchaseCurrency: input.purchaseCurrency,
      sellingCurrency: input.sellingCurrency,
      qualityControlPercent: input.qualityControlPercent,
      transportInsuranceCost: input.transportInsuranceCost,
      duty: input.duty,
      exchangeRate: input.exchangeRate,
      italyAccessoryCosts: input.italyAccessoryCosts,
      tools: input.tools,
      retailMultiplier: input.retailMultiplier,
      optimalMargin: input.optimalMargin,
    },
  });
}

/**
 * The answer to a delete the database refused: what still uses the set, by the rows committed now.
 * It reads no lock: an answer, not a check. `0` uses, gone since the refusal, get the plain message.
 */
async function parameterSetInUse(id: string, prisma: PrismaClient): Promise<TRPCError> {
  const [quotations, merchandisingRows] = await Promise.all([
    prisma.collectionRowQuotation.count({ where: { pricingParameterSetId: id } }),
    prisma.merchandisingPlanRow.count({ where: { pricingParameterSetId: id } }),
  ]);
  const uses = [
    quotations > 0 && `${quotations} ${quotations === 1 ? 'quotazione' : 'quotazioni'}`,
    merchandisingRows > 0 &&
      `${merchandisingRows} ${merchandisingRows === 1 ? 'riga' : 'righe'} di merchandising`,
  ].filter(Boolean);
  const total = quotations + merchandisingRows;
  return new TRPCError({
    code: 'CONFLICT',
    message:
      total === 0
        ? 'Set parametri in uso'
        : `Set parametri in uso da ${uses.join(' e ')}: ${total === 1 ? 'riassegnala' : 'riassegnale'} prima di eliminarlo`,
  });
}

/**
 * Deletes a pricing parameter set that nothing uses. If it was the default, promotes the next set
 * (by orderIndex then createdAt) to default. The foreign keys of collection quotations and
 * merchandising rows are `onDelete: Restrict`, so the database refuses a set they use, by any path;
 * a vendor's enablement of the set goes with it. The scope's lock (`lockDefaultSet`) serializes it
 * with the other writers of the default flag.
 *
 * @throws {TRPCError} NOT_FOUND if the set does not belong to the given brand+season.
 * @throws {TRPCError} CONFLICT if a quotation or a merchandising row still uses the set.
 */
export async function removeParameterSet(
  id: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<void> {
  try {
    await prisma.$transaction(
      async tx => {
        await lockDefaultSet(tx, brandId, seasonId);
        const deleted = await tx.pricingParameterSet.delete({ where: { id, brandId, seasonId } });
        if (deleted.isDefault) {
          const next = await tx.pricingParameterSet.findFirst({
            where: { brandId, seasonId },
            orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
          });
          if (next) {
            // `updateMany`: a set deleted since the read leaves no default, not a false NOT_FOUND.
            await tx.pricingParameterSet.updateMany({
              where: { id: next.id },
              data: { isDefault: true },
            });
          }
        }
      },
      // Stated rather than inherited: the promotion above reads what was committed before it started.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Set parametri non trovato' });
    }
    if (isForeignKeyViolation(err, FOREIGN_KEYS.quotationParameterSet, FOREIGN_KEYS.merchRowParameterSet)) {
      throw await parameterSetInUse(id, prisma);
    }
    throw err;
  }
}
