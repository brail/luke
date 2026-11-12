/**
 * The feedback sync's write against a real database: the notice and the submission update commit
 * together or not at all, the SSE ping follows the commit, and two scans of the same row version
 * notify once (the stale-row guard). GitHub is stubbed (`fetch`); the decision rules are in
 * `feedbackSyncScheduler.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedbackSubmission, PrismaClient } from '@luke/db';

import { syncSubmission } from '../src/lib/feedbackSyncScheduler';
import { insertNotifications, writeNotifications } from '../src/lib/notifications';
import { sseStore } from '../src/lib/sseStore';

import { createSilentLogger, createTestUser, setupTestDb } from './helpers';

vi.mock('../src/lib/notifications', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/notifications')>();
  return { ...actual, writeNotifications: vi.fn(actual.writeNotifications) };
});

const { writeNotifications: realWrite } = await vi.importActual<typeof import('../src/lib/notifications')>('../src/lib/notifications');

const REPO = 'luke-org/luke';
const logger = createSilentLogger();

let prisma: PrismaClient;
let userId: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  userId = (await createTestUser('viewer')).user.id;
  vi.spyOn(sseStore, 'pushToUser');
  // Issue 42 is open with one comment, id 1.
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.includes('/comments')
      ? [{ id: 1 }]
      : { state: 'open', comments: 1, html_url: `https://github.com/${REPO}/issues/42` }))
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function createSubmission(): Promise<FeedbackSubmission> {
  return prisma.feedbackSubmission.create({
    // A past `updatedAt`: the sync's own write cannot land on the same millisecond.
    data: {
      userId,
      issueNumber: 42,
      issueUrl: `https://github.com/${REPO}/issues/42`,
      repo: REPO,
      commentIdsTrackedAt: new Date(),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
    },
  });
}

const reread = (id: string) => prisma.feedbackSubmission.findUniqueOrThrow({ where: { id } });
const notices = () => prisma.notification.count({ where: { userId } });

describe('feedback sync — notice and update in one transaction', () => {
  it('a failure after the notice insert rolls both back, without a ping; the retry notifies once', async () => {
    const submission = await createSubmission();
    vi.mocked(writeNotifications).mockImplementationOnce(async (db, rows) => {
      await realWrite(db, rows);
      expect(await db.notification.count({ where: { userId } })).toBe(1);
      throw new Error('failure after the insert');
    });

    await expect(syncSubmission(prisma, 'ghp_test', submission, logger)).rejects.toThrow('failure after the insert');

    expect(await notices()).toBe(0);
    expect(await reread(submission.id)).toEqual(submission);
    expect(sseStore.pushToUser).not.toHaveBeenCalled();

    vi.mocked(writeNotifications).mockImplementationOnce(async (db, rows) => {
      const written = await realWrite(db, rows);
      expect(sseStore.pushToUser).not.toHaveBeenCalled();
      return written;
    });
    await syncSubmission(prisma, 'ghp_test', await reread(submission.id), logger);

    expect(await notices()).toBe(1);
    expect(sseStore.pushToUser).toHaveBeenCalledTimes(1);
    expect(await reread(submission.id)).toMatchObject({ commentCount: 1, seenCommentIds: [1n] });

    await syncSubmission(prisma, 'ghp_test', await reread(submission.id), logger);
    expect(await notices()).toBe(1);
  });

  it('two scans of the same row version → only the first commits and notifies', async () => {
    const submission = await createSubmission();

    await syncSubmission(prisma, 'ghp_test', submission, logger);
    await syncSubmission(prisma, 'ghp_test', submission, logger);

    expect(await notices()).toBe(1);
    expect(sseStore.pushToUser).toHaveBeenCalledTimes(1);
  });
});

describe('insertNotifications', () => {
  it('nothing to insert → false, no ping; otherwise the row, then the ping', async () => {
    expect(await insertNotifications(prisma, [])).toBe(false);
    expect(sseStore.pushToUser).not.toHaveBeenCalled();

    expect(await insertNotifications(prisma, [{ userId, category: 'SYSTEM', title: 't', message: 'm' }])).toBe(true);
    expect(await notices()).toBe(1);
    expect(sseStore.pushToUser).toHaveBeenCalledWith(userId, { type: 'notification', payload: {} });
  });
});
