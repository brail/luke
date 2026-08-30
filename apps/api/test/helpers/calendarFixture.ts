/**
 * Fixtures for the season calendar, and the brand-scope grant every spec that touches a
 * brand-scoped router needs.
 *
 * Both were being rebuilt by hand in five specs — `calendarAudience`, `calendarDigest`,
 * `seasonCalendarExport`, `phase` and `collectionRowCompletion` — in five slightly different
 * shapes. Nothing about that ceremony is what any of those tests are actually about.
 *
 * Deliberately two small functions rather than one big one. What genuinely varies between specs is
 * *how many* (two brands, five planning groups, events with or without a phase) and what extra rows
 * hang off them; a fixture that tried to express all of it would take more arguments than the rows
 * it creates. A spec needing two calendars calls `createCalendarFixture` twice.
 */

import { randomUUID } from 'crypto';

import type { PrismaClient } from '@prisma/client';

export interface CalendarFixture {
  /** Short uppercase suffix used in every generated code/name, so parallel specs cannot collide. */
  uid: string;
  brandId: string;
  seasonId: string;
  calendarId: string;
  /** The first planning group; more can be added with `prisma.planningGroup.create`. */
  planningGroupId: string;
}

export interface CalendarFixtureOptions {
  /** Prefix for the generated brand/season codes. Keep it short — `Brand.code` caps at 20 chars. */
  prefix?: string;
  /** Season year. Specs that assert on ordering usually want a far-future one. */
  year?: number;
  /** Name of the first planning group. */
  groupName?: string;
}

/**
 * Creates Brand → Season → SeasonCalendar → PlanningGroup, the chain any milestone needs.
 *
 * @returns The ids, plus the `uid` so the caller can keep its own rows collision-free too.
 */
export async function createCalendarFixture(
  prisma: PrismaClient,
  options: CalendarFixtureOptions = {}
): Promise<CalendarFixture> {
  const { prefix = 'CAL', year = 2099, groupName } = options;
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const [brand, season] = await Promise.all([
    prisma.brand.create({
      data: { code: `${prefix}${uid}`.slice(0, 20), name: `${prefix} Brand ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: { code: `${prefix[0]}${uid}`.slice(0, 10), name: `${prefix} Season ${uid}`, year, isActive: true },
    }),
  ]);

  const calendar = await prisma.seasonCalendar.create({
    data: { brandId: brand.id, seasonId: season.id },
  });
  const group = await prisma.planningGroup.create({
    data: { calendarId: calendar.id, name: groupName ?? `${prefix} Group ${uid}` },
  });

  return {
    uid,
    brandId: brand.id,
    seasonId: season.id,
    calendarId: calendar.id,
    planningGroupId: group.id,
  };
}

export interface BrandAccessGrant {
  functionId: string;
  teamId: string;
}

/**
 * Puts the given users on a team whose scope covers the given brands.
 *
 * Without this, `assertBrandAccess` answers FORBIDDEN to every non-admin *before* the permission
 * check runs — so an RBAC test would pass for the wrong reason: it would look like the role was
 * refused when in fact the brand was never visible. Admins bypass the whole thing
 * (`getUserAllowedBrandIds` returns null for them), so they never need this.
 *
 * @returns The function and team ids, for specs that need to add more members or scopes.
 */
export async function grantBrandAccess(
  prisma: PrismaClient,
  params: { brandIds: string[]; userIds: string[]; label?: string }
): Promise<BrandAccessGrant> {
  const { brandIds, userIds, label = 'Scope' } = params;
  const uid = randomUUID().substring(0, 6);

  const fn = await prisma.companyFunction.create({
    data: { slug: `${label.toLowerCase()}_fn_${uid}`, name: `${label} Fn ${uid}`, order: 90, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `${label} Team ${uid}`, isActive: true },
  });

  await Promise.all([
    ...userIds.map(userId =>
      prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } })
    ),
    ...brandIds.map(brandId =>
      prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId } })
    ),
  ]);

  return { functionId: fn.id, teamId: team.id };
}
