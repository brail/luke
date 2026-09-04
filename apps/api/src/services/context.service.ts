/**
 * Context service — brand/season resolution and user preference management.
 * Resolution priority: last-used → org default → first active.
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import { AppContextDefaultsSchema, type AppContextDefaults, type Role } from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import { makeUrlResolver } from '../lib/storageUrl';


/**
 * The brand scope guards live in `brandScope.service.ts` (they need the
 * session, this module doesn't). Re-exported here because this is where the
 * routers that already used them import them from.
 */
export {
  assertBrandAccess,
  assertBrandAccessAll,
  filterAllowedBrandIds,
} from './brandScope.service';

const logger = pino({ level: 'info' });

/** Shape of `UserPreference.data` (Json column) — see schema.prisma doc comment on the model. */
interface UserPreferenceData {
  lastBrandId?: string;
  lastSeasonId?: string;
  menuStates?: Record<string, boolean>;
}

/**
 * Resolved brand and season for the current user session.
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
 * Union of `brandScopes` across a set of (already active-team-filtered) team memberships. The one
 * traversal both `getUserAllowedBrandIds` (single user) and `resolveBrandAccess`
 * (`calendarAudience.service.ts`, batched multi-user) share — they fetch differently-shaped rows
 * for different reasons (the batched path also filters `isActive`/`pendingApproval`, which this
 * one deliberately doesn't do), but the "team → brandScopes → union" step itself is identical and
 * was previously hand-written twice.
 */
export function unionBrandScopes(memberships: { team: { brandScopes: { brandId: string }[] } }[]): Set<string> {
  const brandIds = new Set<string>();
  for (const m of memberships) {
    for (const bs of m.team.brandScopes) brandIds.add(bs.brandId);
  }
  return brandIds;
}

/**
 * Returns the set of brand IDs the user may access via team membership.
 * Admins receive null (unrestricted). Users in no team receive an empty array (no access).
 * A team with no brand scopes contributes nothing — it does not grant unrestricted access.
 *
 * @returns null for admin (unrestricted), or an array of allowed brand IDs.
 */
export async function getUserAllowedBrandIds(
  userId: string,
  prisma: PrismaClient,
  userRole?: Role
): Promise<string[] | null> {
  if (userRole === 'admin') return null;

  const memberships = await prisma.companyTeamMembership.findMany({
    where: { userId, team: { isActive: true } },
    select: { team: { select: { brandScopes: { select: { brandId: true } } } } },
  });

  return [...unionBrandScopes(memberships)];
}


/**
 * Returns the set of CompanyFunction IDs the user may access via team membership.
 * Admins receive null (unrestricted). Users in no team receive an empty array (no access).
 *
 * @returns null for admin (unrestricted), or an array of allowed function IDs.
 */
export async function getUserAllowedFunctionIds(
  userId: string,
  prisma: PrismaClient,
  userRole?: Role
): Promise<string[] | null> {
  if (userRole === 'admin') return null;

  const memberships = await prisma.companyTeamMembership.findMany({
    where: { userId, team: { isActive: true } },
    select: { team: { select: { functionId: true } } },
  });

  return [...new Set(memberships.map(m => m.team.functionId))];
}

/** Both halves of `getUserAllowedBrandIds`/`getUserAllowedFunctionIds`, for callers that need both
 * in the same request (today: the calendar's `listMilestonesDb` and its export-route siblings) —
 * one `companyTeamMembership` query instead of two identical-`where`, different-`select` ones. */
export interface UserAllowedIds {
  brandIds: string[] | null;
  functionIds: string[] | null;
}

export async function getUserAllowedIds(
  userId: string,
  prisma: PrismaClient,
  userRole?: Role
): Promise<UserAllowedIds> {
  if (userRole === 'admin') return { brandIds: null, functionIds: null };

  const memberships = await prisma.companyTeamMembership.findMany({
    where: { userId, team: { isActive: true } },
    select: { team: { select: { functionId: true, brandScopes: { select: { brandId: true } } } } },
  });

  return {
    brandIds: [...unionBrandScopes(memberships)],
    functionIds: [...new Set(memberships.map(m => m.team.functionId))],
  };
}

/**
 * Resolves the active brand and season for a user using a deterministic priority algorithm:
 * last-used preference → org-level AppConfig default → first active record.
 * Respects brand whitelisting from team memberships.
 *
 * @throws {TRPCError} PRECONDITION_FAILED if no active brand or season exists.
 */
export async function resolveContext(
  userId: string,
  prisma: PrismaClient,
  userRole?: Role
): Promise<ContextResult> {
  // Load data in parallel for performance
  const [prefs, allowedBrandIds, appConfig] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    getUserAllowedBrandIds(userId, prisma, userRole),
    prisma.appConfig.findUnique({ where: { key: 'app.context.defaults' } }),
  ]);

  const [brands, seasons] = await Promise.all([
    prisma.brand.findMany({
      where: {
        isActive: true,
        ...(allowedBrandIds ? { id: { in: allowedBrandIds } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    }),
    prisma.season.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { year: 'desc' }],
    }),
  ]);

  if (brands.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No active Brand available. Please configure.',
    });
  }

  const prefsBrandId = (prefs?.data as UserPreferenceData | null)?.lastBrandId;

  if (!seasons.length) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No active Season available. Please configure.',
    });
  }

  // Helper to find an element by ID
  const pick = <T extends { id: string }>(
    list: T[],
    id?: string | null
  ): T | undefined => {
    return id ? list.find(x => x.id === id) : undefined;
  };

  // Parse org-level defaults
  let contextDefaults: AppContextDefaults = { context: {} };
  if (appConfig) {
    try {
      const parsed = JSON.parse(appConfig.value);
      contextDefaults = AppContextDefaultsSchema.parse(parsed);
    } catch (error) {
      logger.warn({ err: error }, 'Errore parsing app.context.defaults, usando default vuoto');
    }
  }

  // Priority-based resolution algorithm
  const appDefBrand = pick(brands, contextDefaults.context?.brandId);
  const appDefSeason = pick(seasons, contextDefaults.context?.seasonId);

  const brand =
    pick(brands, prefsBrandId) ?? appDefBrand ?? brands[0];
  const season =
    pick(seasons, (prefs?.data as UserPreferenceData | null)?.lastSeasonId) ?? appDefSeason ?? seasons[0];

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
 * Saves the user's active brand and season preference. Merges with existing preferences
 * to preserve unrelated fields such as menu state.
 *
 * @throws {TRPCError} BAD_REQUEST if the brand or season is inactive or not found.
 */
export async function setContext(
  userId: string,
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<ContextResult> {
  // Verify that brand and season exist and are active
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

  // Merge the data: preserve menuStates, update brand/season
  const mergedData = {
    ...((currentPrefs?.data as UserPreferenceData | null) ?? {}),
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
 * Reads the org-level context defaults (default brand and season) from AppConfig.
 *
 * @returns Parsed AppContextDefaults, or an empty object if not configured.
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
 * Reads the sidebar menu collapsed/expanded states for a user.
 *
 * @returns A map of menu name to collapsed boolean. Empty object if no preference is saved.
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
    const menuStates = (prefs.data as UserPreferenceData)?.menuStates ?? {};
    return JSON.parse(JSON.stringify(menuStates)) as Record<string, boolean>;
  } catch (error) {
    logger.warn({ err: error }, 'Errore parsing menuCollapsibleStates');
    return {};
  }
}

/**
 * Reads a single key out of the user's consolidated `UserPreference.data` JSON blob.
 *
 * @returns The stored value, or `defaultValue` if unset or of the wrong type.
 */
export async function getUserPreferenceValue<T>(
  userId: string,
  key: string,
  defaultValue: T,
  prisma: PrismaClient
): Promise<T> {
  const prefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { data: true },
  });

  // Arbitrary key provided by the caller — not traceable to the 3 known
  // fields of UserPreferenceData, hence Record<string, unknown> here, not that type.
  const value = (prefs?.data as Record<string, unknown> | null)?.[key];
  return value === undefined ? defaultValue : (value as T);
}

/**
 * Persists a single key into the user's consolidated `UserPreference.data` JSON blob,
 * merging with existing preferences to preserve unrelated fields (brand/season, menu state, etc.).
 */
export async function setUserPreferenceValue<T>(
  userId: string,
  key: string,
  value: T,
  prisma: PrismaClient
): Promise<T> {
  const currentPrefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { data: true },
  });

  // The value is generic (T) but always JSON-serializable by the function's
  // contract (it persists into a Json column) — TS can't prove that from the spread.
  const mergedData = {
    ...((currentPrefs?.data as Record<string, unknown> | null) ?? {}),
    [key]: value,
  } as Prisma.InputJsonValue;

  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, data: mergedData },
    update: { data: mergedData },
  });

  return value;
}

/**
 * Persists sidebar menu collapsed/expanded states for a user.
 * Merges with existing preferences to preserve brand/season selections.
 *
 * @param menuStates - Map of menu name to collapsed boolean.
 * @returns The saved menu states.
 */
export async function setMenuCollapsibleStates(
  userId: string,
  menuStates: Record<string, boolean>,
  prisma: PrismaClient
): Promise<Record<string, boolean>> {
  // Read the current value to preserve other fields
  const currentPrefs = await prisma.userPreference.findUnique({
    where: { userId },
    select: { data: true },
  });

  // Merge the data: preserve brand/season, update menuStates
  const mergedData = {
    ...((currentPrefs?.data as UserPreferenceData | null) ?? {}),
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
    const saved = (updated.data as UserPreferenceData)?.menuStates ?? {};
    return JSON.parse(JSON.stringify(saved)) as Record<string, boolean>;
  } catch (error) {
    logger.warn({ err: error }, 'Errore parsing menuCollapsibleStates after set');
    return menuStates;
  }
}
