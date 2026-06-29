/**
 * Pricing service — price calculation engine and parameter set CRUD.
 * Calculation functions are pure (no I/O). CRUD functions receive PrismaClient as their last argument.
 */

import { TRPCError } from '@trpc/server';
import type { PrismaClient, PricingParameterSet } from '@prisma/client';
import { calculateCompanyMultiplier, roundRetailPrice, type PricingParameterSetInput } from '@luke/core';

// ─────────────────────────────────────────────────────────────────
// Tipi interni
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
// Formule di calcolo pure
// ─────────────────────────────────────────────────────────────────

/**
 * Forward calculation: given a purchase price, computes the retail price through
 * QC → tools → transport → duty → currency conversion → landed cost → wholesale → retail.
 *
 * @returns Breakdown of every intermediate step plus the rounded retail price.
 */
export function calculateForward(
  purchasePrice: number,
  params: CalcParams
): ForwardResult {
  const {
    qualityControlPercent,
    transportInsuranceCost,
    duty,
    exchangeRate,
    italyAccessoryCosts,
    tools,
    retailMultiplier,
    optimalMargin,
    purchaseCurrency,
    sellingCurrency,
  } = params;

  const companyMultiplier = calculateCompanyMultiplier(optimalMargin);

  // Step 1–2: CQ + stampi
  const qualityControlCost = purchasePrice * (qualityControlPercent / 100);
  const priceWithQC = purchasePrice + qualityControlCost + tools;

  // Step 3: Trasporto + assicurazione
  const priceWithTransport = priceWithQC + transportInsuranceCost;

  // Step 4–5: Dazio
  const dutyCost = priceWithTransport * (duty / 100);
  const priceWithDuty = priceWithTransport + dutyCost;

  // Step 6: Conversione valuta + costi Italia
  const landedCost = priceWithDuty / exchangeRate + italyAccessoryCosts;

  // Step 7–9: Moltiplicatori e arrotondamento
  const wholesalePrice = landedCost * companyMultiplier;
  const retailPriceRaw = wholesalePrice * retailMultiplier;
  const retailPrice = roundRetailPrice(retailPriceRaw);

  // Step 10: Margine aziendale reale
  const companyMargin = (wholesalePrice - landedCost) / wholesalePrice;

  return {
    mode: 'forward',
    purchasePrice,
    qualityControlCost: Math.round(qualityControlCost * 100) / 100,
    priceWithQC: Math.round(priceWithQC * 100) / 100,
    transportInsuranceCost,
    priceWithTransport: Math.round(priceWithTransport * 100) / 100,
    dutyCost: Math.round(dutyCost * 100) / 100,
    priceWithDuty: Math.round(priceWithDuty * 100) / 100,
    italyAccessoryCosts,
    landedCost: Math.round(landedCost * 100) / 100,
    companyMultiplier,
    wholesalePrice: Math.round(wholesalePrice * 100) / 100,
    retailPriceRaw: Math.round(retailPriceRaw * 100) / 100,
    retailPrice,
    companyMargin: Math.round(companyMargin * 10000) / 10000,
    purchaseCurrency,
    sellingCurrency,
  };
}

/**
 * Inverse calculation: given a retail price, computes the maximum allowable purchase price
 * while maintaining the target margin. Reverses the forward chain step by step.
 *
 * @returns Breakdown of every intermediate step plus the floor-rounded purchase price.
 */
export function calculateInverse(
  retailPrice: number,
  params: CalcParams
): InverseResult {
  const {
    qualityControlPercent,
    transportInsuranceCost,
    duty,
    exchangeRate,
    italyAccessoryCosts,
    tools,
    retailMultiplier,
    optimalMargin,
    purchaseCurrency,
    sellingCurrency,
  } = params;

  const companyMultiplier = calculateCompanyMultiplier(optimalMargin);

  // Step 1–2: Rimuovi moltiplicatori
  const wholesalePrice = retailPrice / retailMultiplier;
  const landedCost = wholesalePrice / companyMultiplier;

  // Step 3: Rimuovi costi accessori Italia
  const priceWithoutAccessories = landedCost - italyAccessoryCosts;

  // Step 4–5: Rimuovi dazio
  const priceWithoutDuty = priceWithoutAccessories / (1 + duty / 100);
  const dutyCost = priceWithoutAccessories - priceWithoutDuty;

  // Step 6: Converti in valuta di acquisto + rimuovi trasporto
  const priceWithoutTransport =
    priceWithoutDuty * exchangeRate - transportInsuranceCost;

  // Step 7–8: Rimuovi CQ e stampi
  const purchasePriceBeforeTools =
    priceWithoutTransport / (1 + qualityControlPercent / 100);
  const qualityControlCost = priceWithoutTransport - purchasePriceBeforeTools;
  const purchasePriceRaw = purchasePriceBeforeTools - tools;

  // Step 9: Arrotondamento per difetto (1 decimale)
  const purchasePrice = Math.floor(purchasePriceRaw * 10) / 10;

  // Margine aziendale reale
  const companyMargin = (wholesalePrice - landedCost) / wholesalePrice;

  return {
    mode: 'inverse',
    retailPrice,
    wholesalePrice: Math.round(wholesalePrice * 100) / 100,
    landedCost: Math.round(landedCost * 100) / 100,
    priceWithoutAccessories: Math.round(priceWithoutAccessories * 100) / 100,
    dutyCost: Math.round(dutyCost * 100) / 100,
    priceWithoutDuty: Math.round(priceWithoutDuty * 100) / 100,
    priceWithoutTransport: Math.round(priceWithoutTransport * 100) / 100,
    qualityControlCost: Math.round(qualityControlCost * 100) / 100,
    purchasePriceRaw: Math.round(purchasePriceRaw * 100) / 100,
    purchasePrice,
    companyMargin: Math.round(companyMargin * 10000) / 10000,
    purchaseCurrency,
    sellingCurrency,
  };
}

/**
 * Margin-only calculation: given both purchase and retail prices, computes the actual
 * company margin without rounding either input.
 */
export function calculateMarginOnly(
  purchasePrice: number,
  retailPrice: number,
  params: CalcParams
): MarginResult {
  const companyMultiplier = calculateCompanyMultiplier(params.optimalMargin);

  // Calcola landed cost dal prezzo di acquisto (forward fino a landedCost)
  const qualityControlCost =
    purchasePrice * (params.qualityControlPercent / 100);
  const priceWithQC = purchasePrice + qualityControlCost + params.tools;
  const priceWithTransport = priceWithQC + params.transportInsuranceCost;
  const dutyCost = priceWithTransport * (params.duty / 100);
  const priceWithDuty = priceWithTransport + dutyCost;
  const landedCost =
    priceWithDuty / params.exchangeRate + params.italyAccessoryCosts;

  // Calcola wholesale dal prezzo retail (inverso primo step)
  const wholesalePrice = retailPrice / params.retailMultiplier;

  // Margine aziendale reale
  const companyMargin = (wholesalePrice - landedCost) / wholesalePrice;

  return {
    mode: 'margin',
    purchasePrice,
    retailPrice,
    landedCost: Math.round(landedCost * 100) / 100,
    wholesalePrice: Math.round(wholesalePrice * 100) / 100,
    companyMargin: Math.round(companyMargin * 10000) / 10000,
    companyMultiplier,
    purchaseCurrency: params.purchaseCurrency,
    sellingCurrency: params.sellingCurrency,
  };
}

// ─────────────────────────────────────────────────────────────────
// Funzioni CRUD
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
  // Trova la stagione corrente per confrontare year
  const currentSeason = await prisma.season.findUnique({
    where: { id: currentSeasonId },
    select: { year: true, code: true },
  });

  if (!currentSeason) return null;

  // Cerca brand+seasons con parametri, esclusa la stagione corrente, ordinata per year desc
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

  // Carica tutti i set di quella stagione
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

  // Transazione atomica
  return prisma.$transaction(async tx => {
    // Rimuovi default da tutti gli altri
    await tx.pricingParameterSet.updateMany({
      where: { brandId, seasonId, NOT: { id } },
      data: { isDefault: false },
    });
    // Imposta questo come default
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
  // Controlla brand e season esistano
  const [brand, season] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } }),
  ]);

  if (!brand)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
  if (!season)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });

  // Controlla unicità nome per brand+season
  const existing = await prisma.pricingParameterSet.findUnique({
    where: { brandId_seasonId_name: { brandId, seasonId, name: input.name } },
  });
  if (existing) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Esiste già una variante con nome "${input.name}" per questa combinazione brand+stagione`,
    });
  }

  // Se è il primo set per questo brand+season, diventa default
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

  // Controlla unicità nome (esclude sé stesso)
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

    // Se era il default, promuovi il primo rimasto
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
