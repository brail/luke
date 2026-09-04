/**
 * Single predicate for calendar event visibility, exposed in both directions:
 *
 *   canSee(u, e) = u.isActive ∧ ¬u.pendingApproval ∧ P_access(u, e) ∧ P_relevance(u, e)
 *
 *   P_access    : u.role = 'admin'                                    (brand-unrestricted)
 *               ∨ e.calendar.brandId ∈ ⋃ { T.brandScopes : T team attivo di u }
 *
 *   P_relevance : e non ha righe di visibilità                        (fallback permissivo)
 *               ∨ ∃ team attivo T : u ∈ T ∧ T.functionId ∈ e.visibilities
 *               ∨ ∃ CalendarEventUserVisibility(e, u)                 (eccezione per persona)
 *
 * `resolveEventAudience` answers "who receives a notification about event X" (reverse).
 * `eventVisibilityWhere` answers "which events can user X see" (forward, a Prisma `where`
 * fragment for `listMilestonesDb`) — a pure function of already-resolved function ids, mirroring
 * how brand ids are already resolved upstream (`filterAllowedBrandIds`) rather than queried here.
 * Both implement the same predicate — notifications must never exceed what the read path grants,
 * and vice versa.
 *
 * `resolveBrandAccess` is `P_access` alone, exported because the calendar digest also needs
 * it on delete-audit snapshots, where the event no longer exists to resolve `P_relevance` from.
 */

import type { Prisma, PrismaClient } from '@luke/db';

import { unionBrandScopes } from './context.service';


/**
 * `P_access` for a batch of users: userId → Set of accessible brandIds, or `null` for admin
 * (brand-unrestricted). Users that are inactive or pending approval are omitted from the map
 * entirely — a caller must treat "not in the map" as "no access", not as "the empty set".
 *
 * Accepts a transaction client too: `grantUserVisibility` validates brand access as a
 * check-then-act inside its own `$transaction`.
 */
export async function resolveBrandAccess(
  userIds: string[],
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<Map<string, Set<string> | null>> {
  if (userIds.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      role: true,
      isActive: true,
      pendingApproval: true,
      teamMemberships: {
        where: { team: { isActive: true } },
        select: { team: { select: { brandScopes: { select: { brandId: true } } } } },
      },
    },
  });

  const result = new Map<string, Set<string> | null>();
  for (const u of users) {
    if (!u.isActive || u.pendingApproval) continue;
    if (u.role === 'admin') {
      result.set(u.id, null);
      continue;
    }
    result.set(u.id, unionBrandScopes(u.teamMemberships));
  }
  return result;
}

/**
 * Applies `P_access` given a `resolveBrandAccess` map entry: `undefined` (not in the map) means
 * excluded — inactive, pending, or never resolved — `null` means admin (unrestricted), otherwise
 * membership in the set is required. The one place this three-way check is written, so every call
 * site stays correct if `P_access`'s definition of "covers" ever changes.
 */
export function hasBrandAccess(access: Set<string> | null | undefined, brandId: string): boolean {
  return access === null || (access !== undefined && access.has(brandId));
}

/**
 * `P_access` for a batch of brands, in the opposite direction: brandId → Set of userIds with
 * access to it (active, not pending, admins included on every brand). Only used for events with
 * zero visibility rows, where `P_relevance`'s fallback makes every brand-accessible user a
 * candidate — there's no smaller candidate set to start from, unlike the function-visibility path.
 */
async function usersWithBrandAccess(
  brandIds: string[],
  prisma: PrismaClient
): Promise<Map<string, Set<string>>> {
  if (brandIds.length === 0) return new Map();

  const [admins, memberships] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'admin', isActive: true, pendingApproval: false },
      select: { id: true },
    }),
    prisma.companyTeamMembership.findMany({
      where: {
        team: { isActive: true, brandScopes: { some: { brandId: { in: brandIds } } } },
        user: { isActive: true, pendingApproval: false },
      },
      // Filtered to the requested brands too — a team scoped to brands outside `brandIds` would
      // otherwise have every one of its (irrelevant) scope rows fetched and then discarded below.
      select: { userId: true, team: { select: { brandScopes: { where: { brandId: { in: brandIds } }, select: { brandId: true } } } } },
    }),
  ]);

  const adminIds = admins.map(a => a.id);
  const map = new Map<string, Set<string>>(brandIds.map(b => [b, new Set(adminIds)]));
  for (const m of memberships) {
    for (const bs of m.team.brandScopes) {
      map.get(bs.brandId)?.add(m.userId);
    }
  }
  return map;
}

/**
 * Active, non-pending users with access to `brandId` (admins included) — the candidate pool for
 * `grantUserVisibility`'s picker. Same `P_access` boundary the grant itself validates against on
 * save, so nobody offered in the picker can then be rejected.
 */
export async function listUsersWithBrandAccess(
  brandId: string,
  prisma: PrismaClient
): Promise<{ id: string; username: string; firstName: string; lastName: string }[]> {
  const [admins, memberships] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'admin', isActive: true, pendingApproval: false },
      select: { id: true, username: true, firstName: true, lastName: true },
    }),
    prisma.companyTeamMembership.findMany({
      where: {
        team: { isActive: true, brandScopes: { some: { brandId } } },
        user: { isActive: true, pendingApproval: false },
      },
      select: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
    }),
  ]);

  const byId = new Map(admins.map(u => [u.id, u]));
  for (const m of memberships) byId.set(m.user.id, m.user);
  return [...byId.values()];
}

/**
 * Batch resolution of `canSee` in the reverse direction: eventId → recipient userIds.
 * 5 queries when no event needs the zero-visibility fallback, 7 when at least one does.
 */
export async function resolveEventAudience(
  eventIds: string[],
  prisma: PrismaClient
): Promise<Map<string, string[]>> {
  if (eventIds.length === 0) return new Map();

  const [events, fnVisibilities, userVisibilities] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, calendar: { select: { brandId: true } } },
    }),
    prisma.calendarEventVisibility.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, functionId: true },
    }),
    prisma.calendarEventUserVisibility.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, userId: true },
    }),
  ]);

  const brandByEvent = new Map(events.map(e => [e.id, e.calendar.brandId]));
  const hasVisibilityRows = new Set([
    ...fnVisibilities.map(v => v.eventId),
    ...userVisibilities.map(v => v.eventId),
  ]);

  const functionIds = [...new Set(fnVisibilities.map(v => v.functionId))];
  const teamMembers = functionIds.length > 0
    ? await prisma.companyTeamMembership.findMany({
        where: { team: { functionId: { in: functionIds }, isActive: true } },
        select: { userId: true, team: { select: { functionId: true } } },
      })
    : [];

  const fnToUsers = new Map<string, Set<string>>();
  for (const m of teamMembers) {
    if (!fnToUsers.has(m.team.functionId)) fnToUsers.set(m.team.functionId, new Set());
    fnToUsers.get(m.team.functionId)!.add(m.userId);
  }

  const candidatesByEvent = new Map<string, Set<string>>(eventIds.map(id => [id, new Set()]));
  for (const v of fnVisibilities) {
    const set = candidatesByEvent.get(v.eventId);
    if (!set) continue;
    for (const uid of fnToUsers.get(v.functionId) ?? []) set.add(uid);
  }
  for (const v of userVisibilities) candidatesByEvent.get(v.eventId)?.add(v.userId);

  const allCandidateIds = new Set<string>();
  for (const set of candidatesByEvent.values()) for (const id of set) allCandidateIds.add(id);

  const brandIdsNeedingFallback = [...new Set(
    eventIds
      .filter(id => !hasVisibilityRows.has(id))
      .map(id => brandByEvent.get(id))
      .filter((b): b is string => !!b)
  )];

  const [accessMap, usersByBrand] = await Promise.all([
    resolveBrandAccess([...allCandidateIds], prisma),
    usersWithBrandAccess(brandIdsNeedingFallback, prisma),
  ]);

  const result = new Map<string, string[]>();
  for (const id of eventIds) {
    const brandId = brandByEvent.get(id);
    if (!brandId) {
      result.set(id, []);
      continue;
    }

    if (!hasVisibilityRows.has(id)) {
      result.set(id, [...(usersByBrand.get(brandId) ?? new Set<string>())]);
      continue;
    }

    const recipients = new Set<string>();
    for (const uid of candidatesByEvent.get(id) ?? []) {
      if (hasBrandAccess(accessMap.get(uid), brandId)) recipients.add(uid);
    }
    result.set(id, [...recipients]);
  }
  return result;
}

/** Single-event convenience wrapper over `resolveEventAudience`. */
export async function resolveEventAudienceOne(
  eventId: string,
  prisma: PrismaClient
): Promise<string[]> {
  return (await resolveEventAudience([eventId], prisma)).get(eventId) ?? [];
}

/**
 * `P_relevance` in the forward direction: a Prisma `where` fragment restricting `CalendarEvent`
 * to what the user may see, given their already-resolved allowed function ids (`null` = admin,
 * no restriction — resolve via `getUserAllowedFunctionIds`/`getUserAllowedIds`/
 * `brandScope.service.ts`'s `getAllowedFunctionIds`, whichever the caller already has in hand).
 * The caller must still apply brand filtering separately (`filterAllowedBrandIds`/
 * `assertBrandAccess`), this only narrows within already-brand-allowed calendars.
 */
export function eventVisibilityWhere(
  userId: string,
  functionIds: string[] | null
): Prisma.CalendarEventWhereInput | null {
  if (functionIds === null) return null;

  return {
    OR: [
      { visibilities: { none: {} } },
      { visibilities: { some: { functionId: { in: functionIds } } } },
      { userVisibilities: { some: { userId } } },
    ],
  };
}
