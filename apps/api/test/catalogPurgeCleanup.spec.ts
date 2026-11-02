/**
 * After a purge commits, its stored files and Google copies go one by one: a failure is logged and
 * never stops the next item or fails the purge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context } from '../src/lib/context';

vi.mock('../src/storage', () => ({ deleteObjectByKey: vi.fn() }));
vi.mock('../src/services/googleCalendarSync.service', () => ({
  deleteGoogleCopies: vi.fn(),
  deleteGoogleCalendars: vi.fn(),
}));

const { deleteObjectByKey } = await import('../src/storage');
const { deleteGoogleCalendars, deleteGoogleCopies } = await import('../src/services/googleCalendarSync.service');
const { cleanUpAfterPurge } = await import('../src/services/catalogDelete.service');

const logger = { warn: vi.fn() };
const ctx = { prisma: {}, logger } as unknown as Context; // only what the clean-up reads

const leftovers = {
  files: [
    { bucket: 'brand-logos' as const, key: 'logo.png' },
    { bucket: 'collection-row-pictures' as const, key: 'row.jpg' },
  ],
  googleCopies: [{ googleCalendarId: 'gcal-1', googleEventId: 'gev-1' }],
  googleCalendarIds: ['gcal-1', 'gcal-2'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cleanUpAfterPurge', () => {
  it('removes every file, the Google copies and the provisioned calendars', async () => {
    await cleanUpAfterPurge(ctx, leftovers);

    expect(vi.mocked(deleteObjectByKey).mock.calls.map(([, f]) => f)).toEqual(leftovers.files);
    expect(deleteGoogleCopies).toHaveBeenCalledWith(leftovers.googleCopies, ctx.prisma, logger);
    expect(deleteGoogleCalendars).toHaveBeenCalledWith(leftovers.googleCalendarIds, ctx.prisma, logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a failure and goes on with the next item', async () => {
    vi.mocked(deleteObjectByKey).mockRejectedValueOnce(new Error('storage down'));
    vi.mocked(deleteGoogleCopies).mockRejectedValueOnce(new Error('google down'));
    vi.mocked(deleteGoogleCalendars).mockRejectedValueOnce(new Error('google down'));

    await expect(cleanUpAfterPurge(ctx, leftovers)).resolves.toBeUndefined();

    expect(deleteObjectByKey).toHaveBeenCalledTimes(2);
    expect(deleteGoogleCalendars).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});
