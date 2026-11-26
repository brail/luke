/**
 * `feedback.submit` invariants: who can call it, what actually gets sent to
 * GitHub, and what gets persisted (`FeedbackSubmission` row + audit log) —
 * or *not* persisted when the GitHub call fails or config is missing.
 *
 * The GitHub API itself is mocked (`vi.stubGlobal('fetch', ...)`): this is
 * exactly what `procedure-coverage.ts` flagged as the reason `feedback` was
 * uncovered ("apre una issue GitHub reale"). Mocking the external call, not
 * the router, is what makes covering it possible without touching GitHub.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as notifications from '../src/lib/notifications';
import { appRouter } from '../src/routers/index';

import {
  createCallerAs,
  createCallerWithSession,
  createTestContext,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Another active administrator: the one a notice of the submission would reach. */
async function otherAdmin() {
  return (await createTestUser('admin')).user;
}

async function seedFeedbackConfig(repo = 'luke-org/luke'): Promise<string> {
  await prisma.appConfig.createMany({
    data: [
      { key: 'integrations.github.feedbackToken', value: 'ghp_test_token', isEncrypted: false },
      { key: 'integrations.github.feedbackRepo', value: repo, isEncrypted: false },
    ],
  });
  return repo;
}

interface MockIssueResponse {
  ok?: boolean;
  number?: number;
  html_url?: string;
  errorText?: string;
}

function mockGitHubIssueCreate(overrides: MockIssueResponse = {}) {
  const {
    ok = true,
    number = 42,
    html_url = 'https://github.com/luke-org/luke/issues/42',
    errorText = 'Bad credentials',
  } = overrides;

  const fetchMock = vi.fn(async (_url: string, _init?: { headers: Record<string, string>; body: string; signal: AbortSignal }) => ({
    ok,
    status: ok ? 201 : 401,
    json: async () => ({ number, html_url }),
    text: async () => errorText,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('feedback.submit', () => {
  it('anonymous → UNAUTHORIZED, no call to GitHub', async () => {
    const fetchMock = mockGitHubIssueCreate();
    const anon = await createCallerAs(null);

    await expectUnauthorized(
      () => anon.feedback.submit({ type: 'bug', title: 'x', description: 'y' }),
      'UNAUTHORIZED'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an authenticated user (any role) creates the issue, persists the submission and the audit row', async () => {
    const repo = await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate({ number: 42, html_url: 'https://github.com/luke-org/luke/issues/42' });
    const { user, session } = await createTestUser('editor');
    const caller = createCallerWithSession(session).feedback;

    const result = await caller.submit({
      type: 'bug',
      title: 'The price does not save',
      description: 'Passi: apri pricing, modifica un parametro, salva.',
    });

    expect(result).toEqual({ issueNumber: 42 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // `RequestInit` isn't recognized by this file's eslint env; the shape only needs
    // what's read below, so a narrow local type stands in for it.
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string; signal: AbortSignal }];
    expect(url).toBe(`https://api.github.com/repos/${repo}/issues`);
    expect(init.headers.Authorization).toBe('Bearer ghp_test_token');
    const requestBody = JSON.parse(init.body as string);
    // Plausible bug: sending the wrong label, or none — silently miscategorizes every report.
    expect(requestBody.labels).toEqual(['bug']);
    expect(requestBody.title).toBe('The price does not save');
    expect(requestBody.body).toBe(
      `Passi: apri pricing, modifica un parametro, salva.\n\n---\nInviato da: ${user.firstName} ${user.lastName}`
    );

    const submission = await prisma.feedbackSubmission.findFirst({ where: { issueNumber: 42 } });
    expect(submission).toMatchObject({
      userId: user.id,
      issueNumber: 42,
      issueUrl: 'https://github.com/luke-org/luke/issues/42',
      repo,
      status: 'open',
      commentCount: 0,
      seenCommentIds: [],
      commentIdsTrackedAt: expect.any(Date),
    });

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FEEDBACK_SUBMIT' } });
    expect(audit).toMatchObject({
      actorId: user.id,
      targetType: 'Feedback',
      targetId: '42',
      result: 'SUCCESS',
    });
  });

  it('signs the issue with the username when the account has no name', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { user, session } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { firstName: '', lastName: '' } });

    await createCallerWithSession(session).feedback.submit({ type: 'bug', title: 'x', description: 'y' });

    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(requestBody.body).toBe(`y\n\n---\nInviato da: ${user.username}`);
  });

  it('notifies every other active administrator once', async () => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate({ number: 42 });
    const { user: submitter, session } = await createTestUser('admin');
    const admin = await otherAdmin();
    await createTestUser('editor');

    await createCallerWithSession(session).feedback.submit({
      type: 'feature',
      title: 'Aggiungere export PDF',
      description: 'Servirebbe per i report mensili.',
    });

    const notices = await prisma.notification.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      userId: admin.id,
      category: 'SYSTEM',
      title: 'Nuovo suggerimento',
      message: `${submitter.firstName} ${submitter.lastName} ha inviato un suggerimento (#42): «Aggiungere export PDF»`,
      link: null,
      data: { type: 'feedback_submitted', issueNumber: 42 },
    });
  });

  it('sends no notice when the submission cannot be recorded', async () => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    await otherAdmin();
    vi.spyOn(prisma.feedbackSubmission, 'create').mockRejectedValue(new Error('database down'));

    await expect(
      createCallerWithSession(session).feedback.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('still completes when the notice fails, and logs it', async () => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate({ number: 42 });
    const { session } = await createTestUser('editor');
    vi.spyOn(notifications, 'notifyAdmins').mockRejectedValue(new Error('notification store down'));
    const ctx = createTestContext(session);
    const error = vi.spyOn(ctx.logger, 'error');

    await expect(
      appRouter.createCaller(ctx).feedback.submit({ type: 'bug', title: 'x', description: 'y' })
    ).resolves.toEqual({ issueNumber: 42 });
    expect(await prisma.feedbackSubmission.count({ where: { issueNumber: 42 } })).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ issueNumber: 42 }), 'Failed to notify admins of new feedback');
  });

  it('type "feature" uses the enhancement label, not bug', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('viewer');
    const caller = createCallerWithSession(session).feedback;

    await caller.submit({ type: 'feature', title: 'Export PDF', description: 'Servirebbe per i report mensili.' });

    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(requestBody.labels).toEqual(['enhancement']);
  });

  it('feedback config not set → PRECONDITION_FAILED, no fetch, no orphan submission', async () => {
    // beforeEach has already truncated AppConfig: no seedFeedbackConfig() here.
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    await otherAdmin();
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.feedbackSubmission.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('GitHub responds with an error → INTERNAL_SERVER_ERROR, no orphan submission or audit', async () => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate({ ok: false, errorText: 'Bad credentials' });
    const { session } = await createTestUser('admin');
    await otherAdmin();
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    // Plausible bug: persisting the submission row (or the audit line) even though
    // no issue was actually created on GitHub — orphan state pointing nowhere.
    expect(await prisma.feedbackSubmission.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'FEEDBACK_SUBMIT' } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it.each([
    ['no issue number', { number: Number.NaN }],
    ['a link that is not https', { html_url: 'javascript:alert(1)' }],
    ['a link outside GitHub', { html_url: 'https://elsewhere.example/issues/42' }],
  ])('a GitHub answer with %s → INTERNAL_SERVER_ERROR, no orphan submission or audit', async (_label, answer) => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate(answer);
    const { session } = await createTestUser('admin');
    await otherAdmin();

    await expect(
      createCallerWithSession(session).feedback.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Errore nella creazione della segnalazione. Riprova.' });

    expect(await prisma.feedbackSubmission.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'FEEDBACK_SUBMIT' } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a call GitHub never answers is bounded, and answers the same message', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const { session } = await createTestUser('admin');

    await expect(
      createCallerWithSession(session).feedback.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Errore nella creazione della segnalazione. Riprova.' });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('an empty title is rejected by the Zod schema before any fetch', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: '', description: 'y' })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a description over 4000 characters is rejected by the Zod schema', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: 'x', description: 'a'.repeat(4001) })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
