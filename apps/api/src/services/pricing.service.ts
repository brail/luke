/**
 * Pricing service — price calculation engine and parameter set CRUD.
 * Calculation functions are pure (no I/O). CRUD functions receive PrismaClient as their last argument.
 */

import { TRPCError } from '@trpc/server';

import {
  calculateCompanyMultiplier,
  landedCostBreakdown,
  priceForward,
  priceInverse,
  retailMargin,
  roundRetailPrice,
  type PricingParameterSetInput,
} from '@luke/core';
import type { PrismaClient, PricingParameterSet } from '@luke/db';

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
 * @returns Breakdown of every intermediate step plus the rounded retail price.
 */
export function calculateForward(
  purchasePrice: number,
  params: CalcParams
): ForwardResult {
  const f = priceForward(purchasePrice, params);

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
    retailPriceRaw: round2(f.retailPriceRaw),
    retailPrice: roundRetailPrice(f.retailPriceRaw),
    companyMargin: round4(f.companyMargin),
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

/**
 * Inverse calculation: given a retail price, computes the maximum allowable purchase price
 * while maintaining the target margin (`priceInverse`).
 *
 * @returns Breakdown of every intermediate step plus the floor-rounded purchase price.
 */
export function calculateInverse(
  retailPrice: number,
  params: CalcParams
): InverseResult {
  const i = priceInverse(retailPrice, params);

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
    purchasePriceRaw: round2(i.purchasePriceRaw),
    // Down, 1 decimal: rounding the maximum payable price up would erode the margin.
    purchasePrice: Math.floor(i.purchasePriceRaw * 10) / 10,
    companyMargin: round4(i.companyMargin),
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
  return {
    mode: 'margin',
    purchasePrice,
    retailPrice,
    landedCost: round2(landedCostBreakdown(purchasePrice, params).landedCost),
    wholesalePrice: round2(priceInverse(retailPrice, params).wholesalePrice),
    companyMargin: round4(retailMargin(purchasePrice, retailPrice, params)),
    companyMultiplier: calculateCompanyMultiplier(params.optimalMargin),
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

/** Presentation rounding of a money amount. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Presentation rounding of a margin fraction (two decimals of a percentage). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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
 * Atomically marks one parameter set as default and clears the flag on all others
 * in the same brand+season scope.
 *
 * @throws {TRPCError} NOT_FOUND if the parameter set does not belong to the given brand+season.
 */
export async function setAsDefault(
  id: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<PricingParameterSet> {
  const target = await prisma.pricingParameterSet.findFirst({
    where: { id, brandId, seasonId },
  });

  if (!target) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Set parametri non trovato',
    });
  }

  // Atomic transaction
  return prisma.$transaction(async tx => {
    // Remove default from all others
    await tx.pricingParameterSet.updateMany({
      where: { brandId, seasonId, NOT: { id } },
      data: { isDefault: false },
    });
    // Set this one as default
    return tx.pricingParameterSet.update({
      where: { id },
      data: { isDefault: true },
    });
  });
}

/**
 * Creates a new pricing parameter set. Automatically marks it as default if it is the
 * first set for the given brand+season.
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
  // Check that brand and season exist
  const [brand, season] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } }),
  ]);

  if (!brand)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
  if (!season)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });

  // Check name uniqueness for brand+season
  const existing = await prisma.pricingParameterSet.findUnique({
    where: { brandId_seasonId_name: { brandId, seasonId, name: input.name } },
  });
  if (existing) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Esiste già una variante con nome "${input.name}" per questa combinazione brand+stagione`,
    });
  }

  // If it's the first set for this brand+season, it becomes default
  const existingCount = await prisma.pricingParameterSet.count({
    where: { brandId, seasonId },
  });
  const isDefault = existingCount === 0;

  return prisma.pricingParameterSet.create({
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
      isDefault,
      orderIndex: existingCount,
    },
  });
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
 * Deletes a pricing parameter set. If it was the default, automatically promotes
 * the next set (by orderIndex then createdAt) to default.
 *
 * @throws {TRPCError} NOT_FOUND if the set does not belong to the given brand+season.
 */
export async function removeParameterSet(
  id: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<void> {
  const target = await prisma.pricingParameterSet.findFirst({
    where: { id, brandId, seasonId },
  });

  if (!target) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Set parametri non trovato',
    });
  }

  await prisma.$transaction(async tx => {
    await tx.pricingParameterSet.delete({ where: { id } });

    // If it was the default, promote the first one remaining
    if (target.isDefault) {
      const next = await tx.pricingParameterSet.findFirst({
        where: { brandId, seasonId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      });
      if (next) {
        await tx.pricingParameterSet.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  });
}
