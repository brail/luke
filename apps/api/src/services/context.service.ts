/**
 * Context Service per gestione Brand/Season e UserPreference
 * Implementa logica di risoluzione del context con priorità deterministiche
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';
import type { PrismaClient } from '@prisma/client';
import { AppContextDefaultsSchema, type AppContextDefaults } from '@luke/core';

import { makeUrlResolver } from '../lib/storageUrl';

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
    year: number | null;
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

  if (brands.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No active Brand available. Please configure.',
    });
  }

  // Determina il brand corrente per filtrare le stagioni
  const prefsBrandId = (prefs?.data as any)?.lastBrandId as string | undefined;
  const activeBrandId = brands.find(b => b.id === prefsBrandId)?.id ?? brands[0].id;

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

  if (!seasons.length) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No active Season available. Please configure.',
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

  const brand =
    pick(brands, prefsBrandId) ?? appDefBrand ?? brands[0];
  const season =
    pick(seasons, (prefs?.data as any)?.lastSeasonId as string | undefined) ?? appDefSeason ?? seasons[0];

  const resolveContext_ = brand.logoKey ? await makeUrlResolver(prisma) : null;
  return {
    brand: {
      ...brand,
      logoUrl: brand.logoKey && resolveContext_ ? resolveContext_('brand-logos', brand.logoKey) : null,
    },
    season,
  };
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
  const [brand, season, currentPrefs] = await Promise.all([
    prisma.brand.findFirst({ where: { id: brandId, isActive: true } }),
    prisma.season.findFirst({ where: { id: seasonId, isActive: true } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { data: true } }),
  ]);

  if (!brand || !season) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid or inactive Brand/Season',
    });
  }

  // Merge dei dati: preserva menuStates, aggiorna brand/season
  const mergedData = {
    ...((currentPrefs?.data as any) ?? {}),
    lastBrandId: brand.id,
    lastSeasonId: season.id,
  };

  // Upsert UserPreference with consolidated data
  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      data: mergedData,
    },
    update: {
      data: mergedData,
    },
  });

  const resolveSet_ = brand.logoKey ? await makeUrlResolver(prisma) : null;
  return {
    brand: {
      ...brand,
      logoUrl: brand.logoKey && resolveSet_ ? resolveSet_('brand-logos', brand.logoKey) : null,
    },
    season,
  };
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

/**
 * Ottiene lo stato collapsible dei menu per l'utente
 * Restituisce un oggetto con il mapping {menuName: isCollapsed}
 *
 * @param userId - ID dell'utente
 * @param prisma - Client Prisma
 * @returns Object con stati dei menu collapsibili
 */
export async function getMenuCollapsibleStates(
  userId: string,
  prisma: PrismaClient
): Promise<Record<string, boolean>> {
  const prefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { data: true },
  });

  if (!prefs?.data) {
    return {};
  }

  try {
    const menuStates = (prefs.data as any)?.menuStates ?? {};
    return JSON.parse(JSON.stringify(menuStates)) as Record<string, boolean>;
  } catch (error) {
    logger.warn({ err: error }, 'Errore parsing menuCollapsibleStates');
    return {};
  }
}

/**
 * Imposta lo stato collapsible dei menu per l'utente
 * Fa upsert sulla preferenza esistente preservando altri dati
 *
 * @param userId - ID dell'utente
 * @param menuStates - Object con mapping {menuName: isCollapsed}
 * @param prisma - Client Prisma
 * @returns Stati salvati
 */
export async function setMenuCollapsibleStates(
  userId: string,
  menuStates: Record<string, boolean>,
  prisma: PrismaClient
): Promise<Record<string, boolean>> {
  // Leggi il valore attuale per preservare altri campi
  const currentPrefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { data: true },
  });

  // Merge dei dati: preserva brand/season, aggiorna menuStates
  const mergedData = {
    ...((currentPrefs?.data as any) ?? {}),
    menuStates: menuStates,
  };

  const updated = await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      data: mergedData,
    },
    update: {
      data: mergedData,
    },
    select: { data: true },
  });

  try {
    const saved = (updated.data as any)?.menuStates ?? {};
    return JSON.parse(JSON.stringify(saved)) as Record<string, boolean>;
  } catch (error) {
    logger.warn({ err: error }, 'Errore parsing menuCollapsibleStates after set');
    return menuStates;
  }
}
