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

import type { PrismaClient } from '@luke/db';

export interface CalendarFixture {
  /** Short uppercase suffix used in every generated code/name, so parallel specs cannot collide. */
  uid: string;
  brandId: string;
  /** The generated `Brand.code`, for specs asserting on messages that quote it. */
  brandCode: string;
  seasonId: string;
  /** The generated `Season.code`, same reason. */
  seasonCode: string;
  calendarId: string;
  /** The first planning group; more can be added with `prisma.planningGroup.create`. */
  planningGroupId: string;
}

/**
 * Longest accepted `prefix`. `Season.code` caps at 10 characters (aligned with the NAV column), and
 * the code is `prefix + 'S' + a 6-char uid` — so three is what fits with the uid intact.
 */
const MAX_PREFIX_LENGTH = 3;

export interface CalendarFixtureOptions {
  /**
   * Up to three characters, used to tell one spec's rows from another's in a failure message.
   * Longer than that throws: it used to be truncated, which quietly ate the uid instead and turned
   * a naming choice into an intermittent unique-constraint failure.
   */
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
  if (prefix.length === 0 || prefix.length > MAX_PREFIX_LENGTH) {
    throw new Error(`createCalendarFixture: prefix deve essere di 1-${MAX_PREFIX_LENGTH} caratteri, ricevuto "${prefix}"`);
  }
  const uid = randomUUID().substring(0, 6).toUpperCase();

  // `B`/`S` keep the two codes distinguishable in an assertion failure: they used to differ only by
  // `prefix[0]` vs the whole prefix, so `CAL` and `CAT` both produced the same season code.
  const [brand, season] = await Promise.all([
    prisma.brand.create({
      data: { code: `${prefix}B${uid}`, name: `${prefix} Brand ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: { code: `${prefix}S${uid}`, name: `${prefix} Season ${uid}`, year, isActive: true },
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
    brandCode: brand.code,
    seasonId: season.id,
    seasonCode: season.code,
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
 * **It grants two things, not one.** Team membership also puts the users in the team's
 * `CompanyFunction`, which is a separate authorization axis: it feeds `getUserAllowedFunctionIds`
 * and from there `eventVisibilityWhere`, so an event carrying visibility rows becomes readable to
 * them. A spec meant to prove "this user cannot see that milestone" has to account for it, or it
 * will pass for the wrong reason in the other direction.
 *
 * An empty `brandIds` is legitimate and means a team that sees no brand — the case a spec uses to
 * prove that membership alone grants nothing. An empty `userIds` is not: it would grant to nobody
 * and leave unreferenced rows behind, so it throws.
 *
 * The team and its function are always active; a spec proving that an inactive team grants nothing
 * has to deactivate the returned `teamId` itself.
 *
 * @returns The function and team ids, for specs that need to add more members or scopes.
 */
export async function grantBrandAccess(
  prisma: PrismaClient,
  params: {
    brandIds: string[];
    userIds: string[];
    label?: string;
    /**
     * Put the team under an existing function instead of a fresh one. Visibility is measured per
     * function, so a spec comparing two teams that share an audience has to say so — creating one
     * function per call would silently make them disjoint.
     */
    functionId?: string;
  }
): Promise<BrandAccessGrant> {
  const { brandIds, userIds, label = 'Scope', functionId } = params;
  if (userIds.length === 0) {
    throw new Error('grantBrandAccess: userIds vuoto — non concederebbe niente a nessuno');
  }
  const uid = randomUUID().substring(0, 6);

  // `label` reaches a column documented as a URL-safe stable identifier, and callers pass display
  // names like 'Team A/X'. Slugified here rather than trusted: the previous version was well-formed
  // only when the caller also passed `functionId`, so the same argument was valid or not depending
  // on a different one.
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_fn_${uid}`;
  const resolvedFunctionId =
    functionId ??
    (
      await prisma.companyFunction.create({
        data: { slug, name: `${label} Fn ${uid}`, order: 90, isActive: true },
      })
    ).id;
  const team = await prisma.companyTeam.create({
    data: { functionId: resolvedFunctionId, name: `${label} Team ${uid}`, isActive: true },
  });

  // De-duplicated: a repeated id would hit the composite primary key and surface as an opaque
  // P2002 from inside `Promise.all`, in a `beforeAll`, where it reads as a broken fixture.
  await Promise.all([
    ...[...new Set(userIds)].map(userId =>
      prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } })
    ),
    ...[...new Set(brandIds)].map(brandId =>
      prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId } })
    ),
  ]);

  return { functionId: resolvedFunctionId, teamId: team.id };
}
