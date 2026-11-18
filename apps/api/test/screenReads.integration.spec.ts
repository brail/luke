/**
 * A read that serves one screen asks that screen's permission: the team structure, the NAV link
 * pickers of the brand and season dialogs, and the vendor closures tab. Each one's permission gate is
 * checked with the built-in roles and with the single permission that opens it; what each returns is
 * the business of its own spec.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Permission } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerAs, grantEditor, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

type Caller = Awaited<ReturnType<typeof createCallerAs>>;

async function teamId() {
  const uid = randomUUID().substring(0, 8);
  const fn = await prisma.companyFunction.create({ data: { slug: `reads-${uid}`, name: `Reads ${uid}` } });
  const team = await prisma.companyTeam.create({ data: { functionId: fn.id, name: `reads-team-${uid}` } });
  return { functionId: fn.id, teamId: team.id };
}

/** Each read, with the permissions that open it. */
const READS: [string, Permission[], (caller: Caller) => Promise<unknown>][] = [
  ['integrations.nav.brands.list', ['brands:create', 'brands:update'], c => c.integrations.nav.brands.list()],
  ['integrations.nav.seasons.list', ['seasons:create', 'seasons:update'], c => c.integrations.nav.seasons.list()],
  ['company.team.listAllBrands', ['company_team:read'], c => c.company.team.listAllBrands()],
  [
    'holidays.listVendorClosures',
    ['season_calendar:configure'],
    c => c.holidays.listVendorClosures({ vendorId: randomUUID(), seasonId: randomUUID() }),
  ],
  [
    'company.team.listByFunction',
    ['company_team:read'],
    async c => c.company.team.listByFunction({ functionId: (await teamId()).functionId }),
  ],
  ['company.team.getById', ['company_team:read'], async c => c.company.team.getById({ id: (await teamId()).teamId })],
];

describe.each(READS)('%s', (_name, opens, read) => {
  it.each(['editor', 'viewer'] as const)('refuses the %s', async role => {
    await expect(read(await createCallerAs(role))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers the administrator', async () => {
    await expect(read(await createCallerAs('admin'))).resolves.toBeDefined();
  });

  it.each(opens)('answers an editor holding %s alone', async permission => {
    grantEditor(permission);
    await expect(read(await createCallerAs('editor'))).resolves.toBeDefined();
  });
});

it('the team brand list is not opened by the team update permission alone', async () => {
  grantEditor('company_team:update');
  await expect((await createCallerAs('editor')).company.team.listAllBrands()).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
