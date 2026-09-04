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

import {
  createCallerAs,
  createCallerWithSession,
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
});

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

  const fetchMock = vi.fn(async (_url: string, _init?: { headers: Record<string, string>; body: string }) => ({
    ok,
    status: ok ? 201 : 401,
    json: async () => ({ number, html_url }),
    text: async () => errorText,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('feedback.submit', () => {
  it('anonimo → UNAUTHORIZED, nessuna chiamata a GitHub', async () => {
    const fetchMock = mockGitHubIssueCreate();
    const anon = await createCallerAs(null);

    await expectUnauthorized(
      () => anon.feedback.submit({ type: 'bug', title: 'x', description: 'y' }),
      'UNAUTHORIZED'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('utente autenticato (qualsiasi ruolo) crea la issue, persiste la submission e la riga di audit', async () => {
    const repo = await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate({ number: 42, html_url: 'https://github.com/luke-org/luke/issues/42' });
    const { user, session } = await createTestUser('editor');
    const caller = createCallerWithSession(session).feedback;

    const result = await caller.submit({
      type: 'bug',
      title: 'Il prezzo non si salva',
      description: 'Passi: apri pricing, modifica un parametro, salva.',
    });

    expect(result).toEqual({
      issueUrl: 'https://github.com/luke-org/luke/issues/42',
      issueNumber: 42,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // `RequestInit` isn't recognized by this file's eslint env; the shape only needs
    // what's read below, so a narrow local type stands in for it.
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe(`https://api.github.com/repos/${repo}/issues`);
    expect(init.headers.Authorization).toBe('Bearer ghp_test_token');
    const requestBody = JSON.parse(init.body as string);
    // Plausible bug: sending the wrong label, or none — silently miscategorizes every report.
    expect(requestBody.labels).toEqual(['bug']);
    expect(requestBody.title).toBe('Il prezzo non si salva');
    // Plausible bug: the fallback-to-email display name path masking the real submitter.
    expect(requestBody.body).toContain(`Inviato da: ${user.firstName} ${user.lastName} (${user.email})`);

    const submission = await prisma.feedbackSubmission.findFirst({ where: { issueNumber: 42 } });
    expect(submission).toMatchObject({
      userId: user.id,
      issueNumber: 42,
      issueUrl: 'https://github.com/luke-org/luke/issues/42',
      repo,
      status: 'open',
      commentCount: 0,
    });

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FEEDBACK_SUBMIT' } });
    expect(audit).toMatchObject({
      actorId: user.id,
      targetType: 'Feedback',
      targetId: '42',
      result: 'SUCCESS',
    });
  });

  it('type "feature" usa la label enhancement, non bug', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('viewer');
    const caller = createCallerWithSession(session).feedback;

    await caller.submit({ type: 'feature', title: 'Export PDF', description: 'Servirebbe per i report mensili.' });

    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(requestBody.labels).toEqual(['enhancement']);
  });

  it('config feedback non impostata → PRECONDITION_FAILED, nessuna fetch, nessuna submission orfana', async () => {
    // beforeEach ha già troncato AppConfig: nessuna seedFeedbackConfig() qui.
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.feedbackSubmission.count()).toBe(0);
  });

  it('GitHub risponde errore → INTERNAL_SERVER_ERROR, nessuna submission né audit orfani', async () => {
    await seedFeedbackConfig();
    mockGitHubIssueCreate({ ok: false, errorText: 'Bad credentials' });
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: 'x', description: 'y' })
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    // Plausible bug: persisting the submission row (or the audit line) even though
    // no issue was actually created on GitHub — orphan state pointing nowhere.
    expect(await prisma.feedbackSubmission.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'FEEDBACK_SUBMIT' } })).toBe(0);
  });

  it('titolo vuoto è rifiutato dallo schema Zod prima di qualunque fetch', async () => {
    await seedFeedbackConfig();
    const fetchMock = mockGitHubIssueCreate();
    const { session } = await createTestUser('admin');
    const caller = createCallerWithSession(session).feedback;

    await expect(
      caller.submit({ type: 'bug', title: '', description: 'y' })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descrizione oltre 4000 caratteri è rifiutata dallo schema Zod', async () => {
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
