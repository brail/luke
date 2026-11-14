/**
 * Single predicate for calendar event visibility (ADR-041, superseding ADR-014's), exposed in both
 * directions:
 *
 *   canSee(u, e) = u.isActive ∧ ¬u.pendingApproval ∧ P_access(u, e) ∧ P_relevance(u, e)
 *
 *   P_access    : u.role = 'admin'                                    (brand-unrestricted)
 *               ∨ e.calendar.brandId ∈ ⋃ { T.brandScopes : T active team of u }
 *
 *   P_relevance : e has no visibility rows of either kind             (whole-brand fallback)
 *               ∨ ∃ active team T : u ∈ T ∧ T.functionId ∈ e.visibilities
 *                                   ∧ e.calendar.brandId ∈ T.brandScopes
 *               ∨ ∃ CalendarEventUserVisibility(e, u)                 (per-person exception)
 *
 * A team grants its function on its own brands only: function and brand come from the same team.
 * An admin reads every event; they are notified like anyone else, only through a team of theirs
 * (the fallback included) or a per-person row.
 *
 * `resolveEventAudience` answers "who receives a notification about event X" (reverse).
 * `eventVisibilityWhere` answers "which events can user X see" (forward, a Prisma `where`
 * fragment for `listMilestonesDb` and, through `callerEventVisibility`, every read and write by id:
 * ADR-040) — a pure function of the user's already-resolved function → brands pairs
 * (`getUserAllowedIds`), with the brand filter applied upstream (`filterAllowedBrandIds`).
 * Both implement the same predicate — notifications must never exceed what the read path grants,
 * and vice versa.
 *
 * `resolveBrandAccess` is `P_access` alone, exported because the calendar digest also needs
 * it on delete-audit snapshots, where the event no longer exists to resolve `P_relevance` from.
 */

import type { Prisma, PrismaClient } from '@luke/db';

import { APPROVED_ADMIN_WHERE, APPROVED_USER_WHERE } from '../lib/approvedUsers';

import { unionBrandScopes, type FunctionBrands } from './context.service';


/**
 * A team that gives its members both `functionId` and `brandId`: active, of that function, with
 * that brand among its scopes. Function and brand come from the same team. The Google Calendar
 * readers of a (season calendar, function) pair are the members of such a team, plus admins.
 */
export function teamGrantsFunctionAndBrand(functionId: string, brandId: string): Prisma.CompanyTeamWhereInput {
  return { isActive: true, functionId, brandScopes: { some: { brandId } } };
}

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
 * Who an event with zero visibility rows reaches, per brand: brandId → userIds of the active, not
 * pending members of an active team scoped to it — admins too, only that way (ADR-041).
 */
async function usersWithBrandAccess(
  brandIds: string[],
  prisma: PrismaClient
): Promise<Map<string, Set<string>>> {
  if (brandIds.length === 0) return new Map();

  const memberships = await prisma.companyTeamMembership.findMany({
    where: {
      team: { isActive: true, brandScopes: { some: { brandId: { in: brandIds } } } },
      user: APPROVED_USER_WHERE,
    },
    // Filtered to the requested brands too — a team scoped to brands outside `brandIds` would
    // otherwise have every one of its (irrelevant) scope rows fetched and then discarded below.
    select: { userId: true, team: { select: { brandScopes: { where: { brandId: { in: brandIds } }, select: { brandId: true } } } } },
  });

  const map = new Map<string, Set<string>>(brandIds.map(b => [b, new Set()]));
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
      where: APPROVED_ADMIN_WHERE,
      select: { id: true, username: true, firstName: true, lastName: true },
    }),
    prisma.companyTeamMembership.findMany({
      where: {
        team: { isActive: true, brandScopes: { some: { brandId } } },
        user: APPROVED_USER_WHERE,
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
 * 5 queries when no event needs the zero-visibility fallback, 6 when at least one does.
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
        // Only the brands of these events: a pair on another brand is never looked up.
        select: { userId: true, team: { select: { functionId: true, brandScopes: { where: { brandId: { in: [...new Set(brandByEvent.values())] } }, select: { brandId: true } } } } },
      })
    : [];

  // function → "functionId:brandId" pairs → members of a team holding that pair.
  const membersByPair = new Map<string, Set<string>>();
  for (const m of teamMembers) {
    for (const bs of m.team.brandScopes) {
      const pair = `${m.team.functionId}:${bs.brandId}`;
      if (!membersByPair.has(pair)) membersByPair.set(pair, new Set());
      membersByPair.get(pair)!.add(m.userId);
    }
  }

  // Through a team holding (function, event brand): brand already checked, only active/pending left.
  const byTeamByEvent = new Map<string, Set<string>>(eventIds.map(id => [id, new Set()]));
  for (const v of fnVisibilities) {
    const brandId = brandByEvent.get(v.eventId);
    const set = byTeamByEvent.get(v.eventId);
    if (!brandId || !set) continue;
    for (const uid of membersByPair.get(`${v.functionId}:${brandId}`) ?? []) set.add(uid);
  }
  // Through a per-person row: brand access from any team still required.
  const byPersonByEvent = new Map<string, Set<string>>(eventIds.map(id => [id, new Set()]));
  for (const v of userVisibilities) byPersonByEvent.get(v.eventId)?.add(v.userId);

  const allCandidateIds = new Set<string>();
  for (const set of [...byTeamByEvent.values(), ...byPersonByEvent.values()]) for (const id of set) allCandidateIds.add(id);

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
    for (const uid of byTeamByEvent.get(id) ?? []) {
      if (accessMap.has(uid)) recipients.add(uid);
    }
    for (const uid of byPersonByEvent.get(id) ?? []) {
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
 * to what the user may see, given the function → brands pairs their teams grant (`null` = admin,
 * no restriction: an empty fragment — resolve via `getUserAllowedIds`, or `brandScope.service.ts`'s
 * `callerEventVisibility` for a request's caller). Each function arm carries its own brands, so a
 * pair counts only when one team holds both. Compose it with `AND: [fragment]`, so that it cannot
 * overwrite a key of the `where` it joins. The caller must still apply brand filtering separately
 * (`filterAllowedBrandIds`/`assertBrandAccess`): the fallback and the per-person arm need it.
 */
export function eventVisibilityWhere(
  userId: string,
  functionBrands: FunctionBrands | null
): Prisma.CalendarEventWhereInput {
  if (functionBrands === null) return {};

  return {
    OR: [
      { visibilities: { none: {} }, userVisibilities: { none: {} } },
      ...[...functionBrands].map(([functionId, brandIds]) => ({
        visibilities: { some: { functionId } },
        calendar: { brandId: { in: [...brandIds] } },
      })),
      { userVisibilities: { some: { userId } } },
    ],
  };
}
