/**
 * Context Service per gestione Brand/Season e UserPreference
 * Implementa logica di risoluzione del context con priorità deterministiche
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';
import type { PrismaClient } from '@prisma/client';
import { AppContextDefaultsSchema, type AppContextDefaults } from '@luke/core';

const logger = pino({ level: 'info' });

/**
 * Risultato del context resolver
 */
export interface ContextResult {
  brand: {
    id: string;
    code: string;
    name: string;
    logoUrl: string | null;
    isActive: boolean;
  };
  season: {
    id: string;
    code: string;
    year: number;
    name: string;
    isActive: boolean;
  };
}

/**
 * Restituisce i brand ID consentiti per un utente.
 * Se l'utente non ha restrizioni, restituisce null (= tutti i brand).
 */
export async function getUserAllowedBrandIds(
  userId: string,
  prisma: PrismaClient
): Promise<string[] | null> {
  const rows = await prisma.userBrandAccess.findMany({
    where: { userId },
    select: { brandId: true },
  });
  return rows.length > 0 ? rows.map(r => r.brandId) : null;
}

/**
 * Restituisce i season ID consentiti per un utente+brand.
 * Se l'utente non ha restrizioni per quel brand, restituisce null (= tutte le stagioni).
 */
export async function getUserAllowedSeasonIds(
  userId: string,
  brandId: string,
  prisma: PrismaClient
): Promise<string[] | null> {
  const rows = await prisma.userSeasonAccess.findMany({
    where: { userId, brandId },
    select: { seasonId: true },
  });
  return rows.length > 0 ? rows.map(r => r.seasonId) : null;
}

/**
 * Risolve il context per un utente con algoritmo deterministico
 * Priorità: lastUsed → orgDefault → firstActive
 * Rispetta il whitelist brand/season dell'utente.
 *
 * @param userId - ID dell'utente
 * @param prisma - Client Prisma
 * @returns Context risolto (brand + season)
 */
export async function resolveContext(
  userId: string,
  prisma: PrismaClient
): Promise<ContextResult> {
  // Carica dati in parallelo per performance
  const [prefs, allowedBrandIds, appConfig] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    getUserAllowedBrandIds(userId, prisma),
    prisma.appConfig.findUnique({ where: { key: 'app.context.defaults' } }),
  ]);

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      ...(allowedBrandIds ? { id: { in: allowedBrandIds } } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  });

  // Determina il brand corrente per filtrare le stagioni
  const prefs_brandId = prefs?.lastBrandId;
  const activeBrandId = brands.find(b => b.id === prefs_brandId)?.id ?? brands[0]?.id;

  const allowedSeasonIds = activeBrandId
    ? await getUserAllowedSeasonIds(userId, activeBrandId, prisma)
    : null;

  const seasons = await prisma.season.findMany({
    where: {
      isActive: true,
      ...(allowedSeasonIds ? { id: { in: allowedSeasonIds } } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { year: 'desc' }],
  });

  // Verifica che ci siano brand e season attivi
  if (!brands.length || !seasons.length) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No active Brand or Season available. Please configure.',
    });
  }

  // Helper per trovare un elemento per ID
  const pick = <T extends { id: string }>(
    list: T[],
    id?: string | null
  ): T | undefined => {
    return id ? list.find(x => x.id === id) : undefined;
  };

  // Parse defaults organizzativi
  let contextDefaults: AppContextDefaults = { context: {} };
  if (appConfig) {
    try {
      const parsed = JSON.parse(appConfig.value);
      contextDefaults = AppContextDefaultsSchema.parse(parsed);
    } catch (error) {
      logger.warn({ err: error }, 'Errore parsing app.context.defaults, usando default vuoto');
    }
  }

  // Algoritmo di risoluzione con priorità
  const appDefBrand = pick(brands, contextDefaults.context?.brandId);
  const appDefSeason = pick(seasons, contextDefaults.context?.seasonId);

  const brand = pick(brands, prefs?.lastBrandId) ?? appDefBrand ?? brands[0];
  const season =
    pick(seasons, prefs?.lastSeasonId) ?? appDefSeason ?? seasons[0];

  return { brand, season };
}

/**
 * Imposta il context per un utente
 * Valida che brand e season siano attivi prima di salvare
 *
 * @param userId - ID dell'utente
 * @param brandId - ID del brand
 * @param seasonId - ID del season
 * @param prisma - Client Prisma
 * @returns Context impostato (brand + season)
 */
export async function setContext(
  userId: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<ContextResult> {
  // Verifica che brand e season esistano e siano attivi
  const [brand, season] = await Promise.all([
    prisma.brand.findFirst({ where: { id: brandId, isActive: true } }),
    prisma.season.findFirst({ where: { id: seasonId, isActive: true } }),
  ]);

  if (!brand || !season) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid or inactive Brand/Season',
    });
  }

  // Upsert UserPreference
  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      lastBrandId: brand.id,
      lastSeasonId: season.id,
    },
    update: {
      lastBrandId: brand.id,
      lastSeasonId: season.id,
    },
  });

  return { brand, season };
}

/**
 * Ottiene i defaults del context dall'AppConfig
 *
 * @param prisma - Client Prisma
 * @returns Defaults del context o oggetto vuoto
 */
export async function getContextDefaults(
  prisma: PrismaClient
): Promise<AppContextDefaults> {
  const appConfig = await prisma.appConfig.findUnique({
    where: { key: 'app.context.defaults' },
  });

  if (!appConfig) {
    return { context: {} };
  }

  try {
    const parsed = JSON.parse(appConfig.value);
    return AppContextDefaultsSchema.parse(parsed);
  } catch (error) {
    logger.warn({ err: error }, 'Errore parsing app.context.defaults, usando default vuoto');
    return { context: {} };
  }
}
