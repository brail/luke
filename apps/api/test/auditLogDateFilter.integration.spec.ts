/**
 * The audit log shows each row in the reader's time zone, so the days picked in its date filter are
 * days in that zone. The browser used to turn them into instants, reading "from" as UTC midnight and
 * "to" in its own zone; the server now takes the calendar days and reads them in the reader's zone,
 * for the list and the export alike.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { verifyAuditLogExportToken } from '../src/utils/downloadToken';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

const ACTION = 'TEST_DAY_BOUNDS';

let prisma: PrismaClient;
let caller: ReturnType<typeof createCallerWithSession>;

beforeAll(async () => {
  prisma = await setupTestDb();
  const admin = await createTestUser('admin');
  // UTC+13 in October (daylight time): 9 October there runs from 8 Oct 11:00Z to 9 Oct 11:00Z.
  await prisma.user.update({ where: { id: admin.user.id }, data: { timezone: 'Pacific/Auckland' } });
  caller = createCallerWithSession(admin.session);
  await prisma.auditLog.createMany({
    data: ['2026-10-08T10:59:59.999Z', '2026-10-08T11:00:00.000Z', '2026-10-09T10:59:59.999Z', '2026-10-09T11:00:00.000Z'].map(
      at => ({ action: ACTION, targetType: 'Test', result: 'SUCCESS', createdAt: new Date(at) })
    ),
  });
});

const instants = async (dateFrom?: string, dateTo?: string) =>
  (await caller.auditLog.list({ action: ACTION, dateFrom, dateTo, limit: 100 })).items
    .map(row => new Date(row.createdAt).toISOString())
    .sort();

describe('auditLog date filter — whole days in the reader zone', () => {
  it('keeps exactly the rows of the day picked', async () => {
    expect(await instants('2026-10-09', '2026-10-09')).toEqual(['2026-10-08T11:00:00.000Z', '2026-10-09T10:59:59.999Z']);
  });

  it('takes the last day the calendar holds as an open end', async () => {
    expect(await instants('2026-10-09', '9999-12-31')).toEqual([
      '2026-10-08T11:00:00.000Z',
      '2026-10-09T10:59:59.999Z',
      '2026-10-09T11:00:00.000Z',
    ]);
  });

  it('refuses a day that does not exist', async () => {
    await expect(instants('2026-02-30')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('signs the reader zone into the export link', async () => {
    const { token } = await caller.auditLog.getExportLink({ dateFrom: '2026-10-09' });
    expect(verifyAuditLogExportToken(token).timeZone).toBe('Pacific/Auckland');
  });
});
