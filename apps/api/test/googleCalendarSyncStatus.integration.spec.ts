/**
 * A Google Calendar sync that fails is visible (#223). Each operation (event sync, reader reconcile,
 * deletes) keeps its last success and its last failure in `IntegrationStatus`, which the Google
 * settings page shows, and a failure tells the admins, at most once per window and operation. Work
 * that never reaches Google records nothing, so a quiet pass cannot hide an earlier failure.
 *
 * Google is mocked on the package namespace, as in `googleCalendarReaders`.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { PrismaClient } from '@luke/db';

import { deleteConfig, saveConfig } from '../src/lib/configManager';
import {
  deleteGoogleCalendars,
  deleteGoogleCopies,
  getConfiguredGoogleClient,
  reconcileCalendar,
  reconcileGoogleReaders,
  syncOneMilestone,
} from '../src/services/googleCalendarSync.service';

import { createCallerAs, createTestUser, setupTestDb } from './helpers';
import { createCalendarFixture, type CalendarFixture } from './helpers/calendarFixture';

let prisma: PrismaClient;
let fixture: CalendarFixture;
let functionId: string;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const noChange: calendar.AclSyncResult = { added: 0, removed: 0, errors: [], unmanaged: [] };

/** Google's refusal of the token request when the impersonated identity has no delegation. */
const refused = () => Object.assign(new Error('unauthorized_client'), { code: 401 });
const googleError = (code: number) => Object.assign(new Error(`Google answered ${code}`), { code });

const status = (operation: 'events' | 'readers' | 'delete') =>
  prisma.integrationStatus.findUnique({ where: { integration: `google-calendar:${operation}` } });

const notices = () => prisma.notification.findMany({ where: { category: 'SYSTEM' }, orderBy: { createdAt: 'asc' } });

const failedWith = (message: string) => ({
  lastSuccessAt: null,
  lastErrorAt: expect.any(Date),
  lastError: expect.stringContaining(message),
});
const succeeded = { lastSuccessAt: expect.any(Date), lastErrorAt: null, lastError: null };

async function newEvent(): Promise<string> {
  const event = await prisma.calendarEvent.create({
    data: {
      calendarId: fixture.calendarId,
      planningGroupId: fixture.planningGroupId,
      title: `Event ${randomUUID().slice(0, 6)}`,
      startAt: new Date('2099-06-01T09:00:00.000Z'),
      visibilities: { create: [{ functionId }] },
    },
  });
  return event.id;
}

async function newBinding(googleCalendarId: string, companyFunctionId = functionId) {
  await prisma.googleCalendarBinding.create({
    data: { seasonCalendarId: fixture.calendarId, companyFunctionId, googleCalendarId, isProvisioned: true },
  });
}

beforeEach(async () => {
  prisma = await setupTestDb();
  await saveConfig(prisma, 'integrations.google.domain', 'example.com');
  await saveConfig(prisma, 'integrations.google.serviceEmail', 'luke@example.com');
  await saveConfig(prisma, 'integrations.google.serviceKey', 'not-a-real-key', true);
  await saveConfig(prisma, 'integrations.google.calendarSync.enabled', 'true');
  fixture = await createCalendarFixture(prisma, { prefix: 'GSS' });
  functionId = (await prisma.companyFunction.create({
    data: { slug: `gss_${fixture.uid.toLowerCase()}`, name: 'Sync status', order: 92, isActive: true },
  })).id;
  await createTestUser('admin');
});

afterEach(() => {
  vi.restoreAllMocks();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

describe('event sync', () => {
  it('records a refused token as the events failure and tells the admins once per window', async () => {
    vi.spyOn(calendar, 'syncMilestone').mockRejectedValue(refused());
    const eventId = await newEvent();

    await expect(syncOneMilestone(eventId, prisma, logger)).rejects.toThrow('unauthorized_client');
    await expect(syncOneMilestone(eventId, prisma, logger)).rejects.toThrow('unauthorized_client');

    expect(await status('events')).toMatchObject(failedWith('unauthorized_client'));
    const sent = await notices();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ link: '/settings/google', data: { type: 'google_sync_failure' } });
  });

  it('records a sync that reached Google as a success', async () => {
    vi.spyOn(calendar, 'syncMilestone').mockResolvedValue(true);

    await syncOneMilestone(await newEvent(), prisma, logger);

    expect(await status('events')).toMatchObject(succeeded);
    expect(await notices()).toHaveLength(0);
  });

  it('records nothing for a sync that called no Google API', async () => {
    vi.spyOn(calendar, 'syncMilestone').mockResolvedValue(false);

    await syncOneMilestone(await newEvent(), prisma, logger);

    expect(await status('events')).toBeNull();
  });

  it('treats an event deleted before its sync as nothing to do', async () => {
    const sync = vi.spyOn(calendar, 'syncMilestone');

    await expect(syncOneMilestone(randomUUID(), prisma, logger)).resolves.toBeUndefined();

    expect(sync).not.toHaveBeenCalled();
    expect(await status('events')).toBeNull();
  });

  it('records nothing while Google is not configured', async () => {
    await deleteConfig({ prisma }, 'integrations.google.serviceKey');
    const sync = vi.spyOn(calendar, 'syncMilestone');

    await syncOneMilestone(await newEvent(), prisma, logger);

    expect(sync).not.toHaveBeenCalled();
    expect(await status('events')).toBeNull();
  });

  it('records an unreadable stored credential as a failure, with its notice', async () => {
    await prisma.appConfig.update({
      where: { key: 'integrations.google.serviceKey' },
      data: { value: 'not-a-ciphertext', isEncrypted: true },
    });

    await expect(syncOneMilestone(await newEvent(), prisma, logger)).rejects.toThrow();

    expect(await status('events')).toMatchObject({ lastSuccessAt: null, lastErrorAt: expect.any(Date) });
    expect(await notices()).toHaveLength(1);
  });

  it('a failing status write fails neither the sync nor its error', async () => {
    vi.spyOn(prisma.integrationStatus, 'upsert').mockRejectedValue(new Error('database unreachable'));
    const sync = vi.spyOn(calendar, 'syncMilestone').mockResolvedValue(true);
    const eventId = await newEvent();

    await expect(syncOneMilestone(eventId, prisma, logger)).resolves.toBeUndefined();
    sync.mockRejectedValue(refused());
    await expect(syncOneMilestone(eventId, prisma, logger)).rejects.toThrow('unauthorized_client');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('calendar reconcile', () => {
  it('records a run with a failing event as a failure, not a success', async () => {
    await newEvent();
    await newEvent();
    vi.spyOn(calendar, 'syncMilestone').mockResolvedValueOnce(true).mockRejectedValueOnce(refused());

    expect(await reconcileCalendar(fixture.calendarId, prisma, logger)).toEqual({ synced: 1, errors: 1 });

    expect(await status('events')).toMatchObject(failedWith('unauthorized_client'));
  });

  it('records a run that reached Google as a success, and one that did not as nothing', async () => {
    await newEvent();
    const sync = vi.spyOn(calendar, 'syncMilestone').mockResolvedValue(false);

    await reconcileCalendar(fixture.calendarId, prisma, logger);
    expect(await status('events')).toBeNull();

    sync.mockResolvedValue(true);
    await reconcileCalendar(fixture.calendarId, prisma, logger);
    expect(await status('events')).toMatchObject(succeeded);
  });
});

describe('reader reconcile', () => {
  it('records a refused reader change as a failure', async () => {
    await newBinding('gcal-1');
    vi.spyOn(calendar, 'syncCalendarAcl').mockResolvedValue({ ...noChange, errors: [new Error('reader refused')] });

    await reconcileGoogleReaders(prisma, logger);

    expect(await status('readers')).toMatchObject(failedWith('reader refused'));
    expect(await notices()).toHaveLength(1);
  });

  it('records one calendar synced and one failing as a failure', async () => {
    const other = (await prisma.companyFunction.create({
      data: { slug: `gss2_${fixture.uid.toLowerCase()}`, name: 'Sync status 2', order: 93, isActive: true },
    })).id;
    await newBinding('gcal-ok');
    await newBinding('gcal-ko', other);
    vi.spyOn(calendar, 'syncCalendarAcl').mockImplementation(async id => {
      if (id === 'gcal-ko') throw googleError(500);
      return noChange;
    });

    expect(await reconcileGoogleReaders(prisma, logger)).toMatchObject({ calendars: 2, failed: 1 });

    expect(await status('readers')).toMatchObject(failedWith('Google answered 500'));
  });

  it('records a pass that read an ACL as a success, and one whose calendars are all gone as nothing', async () => {
    await newBinding('gcal-1');
    const acl = vi.spyOn(calendar, 'syncCalendarAcl').mockRejectedValue(googleError(404));

    await reconcileGoogleReaders(prisma, logger);
    expect(await status('readers')).toBeNull();

    acl.mockResolvedValue(noChange);
    await reconcileGoogleReaders(prisma, logger);
    expect(await status('readers')).toMatchObject(succeeded);
    expect(await notices()).toHaveLength(0);
  });
});

describe('deletes', () => {
  // A copy or calendar already gone from Google resolves too: `@luke/calendar` owns that rule.
  it('records deletes Google accepted as a success', async () => {
    vi.spyOn(calendar, 'deleteEvent').mockResolvedValue(undefined);
    vi.spyOn(calendar, 'deleteCalendar').mockResolvedValue(undefined);

    await deleteGoogleCopies([{ googleCalendarId: 'gcal-1', googleEventId: 'gev-1' }], prisma, logger);
    await deleteGoogleCalendars(['gcal-1'], prisma, logger);

    expect(await status('delete')).toMatchObject(succeeded);
    expect(await notices()).toHaveLength(0);
  });

  it('records a refused delete as a failure', async () => {
    vi.spyOn(calendar, 'deleteCalendar').mockRejectedValue(googleError(403));

    await deleteGoogleCalendars(['gcal-1'], prisma, logger);

    expect(await status('delete')).toMatchObject(failedWith('Google answered 403'));
    expect(await notices()).toHaveLength(1);
  });
});

it('an events failure still notifies within the window of a readers failure', async () => {
  await newBinding('gcal-1');
  vi.spyOn(calendar, 'syncCalendarAcl').mockRejectedValue(googleError(500));
  vi.spyOn(calendar, 'syncMilestone').mockRejectedValue(refused());

  await reconcileGoogleReaders(prisma, logger);
  await expect(syncOneMilestone(await newEvent(), prisma, logger)).rejects.toThrow();

  const titles = (await notices()).map(n => n.title);
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

describe('integrations.google.getSyncStatus', () => {
  it('returns the recorded operations, in a fixed order', async () => {
    const caller = await createCallerAs('admin');
    expect(await caller.integrations.google.getSyncStatus()).toEqual([]);

    await newBinding('gcal-1');
    vi.spyOn(calendar, 'syncCalendarAcl').mockRejectedValue(googleError(500));
    vi.spyOn(calendar, 'syncMilestone').mockResolvedValue(true);
    await reconcileGoogleReaders(prisma, logger);
    await syncOneMilestone(await newEvent(), prisma, logger);

    expect(await caller.integrations.google.getSyncStatus()).toEqual([
      { operation: 'events', ...succeeded },
      { operation: 'readers', ...failedWith('Google answered 500') },
    ]);
  });
});

describe('the connection test and the sync use the same Google identity', () => {
  it.each([
    ['a service account with impersonation', { impersonateEmail: 'luke-calendar@example.com' }, async () => {
      await saveConfig(prisma, 'integrations.google.impersonateEmail', 'luke-calendar@example.com');
    }],
    ['an OAuth user', { mode: 'oauth_user', refreshToken: 'refresh-token' }, async () => {
      await saveConfig(prisma, 'integrations.google.authMode', 'oauth_user');
      await saveConfig(prisma, 'integrations.google.oauth.clientId', 'client-id');
      await saveConfig(prisma, 'integrations.google.oauth.clientSecret', 'client-secret', true);
      await saveConfig(prisma, 'integrations.google.oauth.refreshToken', 'refresh-token', true);
    }],
  ])('%s', async (_label, expected, configure) => {
    await configure();
    const built = vi.spyOn(calendar, 'createGoogleCalendarClient');
    const tested = vi.spyOn(calendar, 'testGoogleConnection').mockResolvedValue({ ok: true });

    await getConfiguredGoogleClient(prisma);
    await (await createCallerAs('admin')).integrations.google.testConnection();

    expect(built).toHaveBeenCalledOnce();
    expect(tested).toHaveBeenCalledOnce();
    expect(built.mock.calls[0][0]).toMatchObject(expected);
    expect(tested.mock.calls[0][0]).toEqual(built.mock.calls[0][0]);
  });
});
