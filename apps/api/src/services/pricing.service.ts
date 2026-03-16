/**
 * Pricing Service — Calcolatrice prezzi e gestione varianti parametri
 *
 * Implementa le stesse formule della PRICINGAPP esterna.
 * Le funzioni di calcolo sono pure (no dipendenze esterne).
 * Le funzioni CRUD ricevono il client Prisma come argomento.
 */

import { TRPCError } from '@trpc/server';
import type { PrismaClient, PricingParameterSet } from '@prisma/client';
import type { PricingParameterSetInput } from '@luke/core';

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
 * Calcola il moltiplicatore aziendale a partire dal margine ottimale.
 * Formula: 1 / (1 - margine%)
 * Es. margine 25% → 1 / (1 - 0.25) = 1.333
 */
export function calculateCompanyMultiplier(optimalMargin: number): number {
  return Math.round((1 / (1 - optimalMargin / 100)) * 100) / 100;
}

/**
 * Arrotondamento commerciale: porta il prezzo al valore xx.9 più vicino.
 *
 * Logica:
 *  - price < 10 → 9.9
 *  - unità+decimale 0.0–2.4 → decina precedente + 9.9
 *  - unità+decimale 2.5–7.4 → decina corrente + 4.9
 *  - unità+decimale 7.5–9.9 → decina corrente + 9.9
 *
 * Esempi: 21.43 → 19.9 | 45.60 → 44.9 | 67.80 → 69.9
 */
export function roundRetailPrice(price: number): number {
  if (price < 10) return 9.9;

  const integerPart = Math.floor(price);
  const decimalPart = price - integerPart;
  const tens = Math.floor(integerPart / 10) * 10;
  const finalPart = (integerPart % 10) + decimalPart;

  if (finalPart >= 0.0 && finalPart <= 2.4) {
    return Math.max(9.9, tens - 10 + 9.9);
  } else if (finalPart >= 2.5 && finalPart <= 7.4) {
    return tens + 4.9;
  } else {
    return tens + 9.9;
  }
}

/**
 * Calcolo forward: dato il prezzo di acquisto, calcola il prezzo retail.
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
 * Calcolo inverso: dato il prezzo retail, calcola il prezzo di acquisto massimo.
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
 * Calcolo margine: noti entrambi i prezzi, calcola il margine aziendale reale.
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
 * Restituisce i set di parametri per un brand+season, ordinati per orderIndex.
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
 * Cerca i set di parametri dalla stagione più recente con dati per quel brand.
 * Usato per la funzione "Copia da stagione precedente".
 *
 * @returns I set della stagione più recente, oppure null se non esistono
 */
export async function getPreviousSeasonSets(
  brandId: string,
  currentSeasonId: string,
  prisma: PrismaClient
): Promise<{
  season: { id: string; code: string; year: number; name: string };
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
 * Imposta un set come default per brand+season (atomico: rimuove il default dagli altri).
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
 * Crea un nuovo set di parametri.
 * Se è il primo per quel brand+season, viene automaticamente impostato come default.
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
 * Aggiorna un set di parametri esistente.
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
 * Elimina un set di parametri.
 * Se era il default, promuove automaticamente il successivo.
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
