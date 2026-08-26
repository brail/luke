/**
 * Unit tests for the orchestration of `feedbackSyncScheduler.ts`: which
 * submissions get polled, when a GitHub issue update turns into a
 * notification (new comment vs. closed), and that one submission's failure
 * doesn't block the others in the same tick.
 *
 * Mocked: `configManager` (token/interval are inputs, not what's tested),
 * `notifications` (only that it's called with the right shape, not its own
 * preference-check logic — covered elsewhere), `schedulerLock`/`maintenanceMode`
 * (cross-instance locking and maintenance gating are covered by their own
 * suites — bypassed here to test only the sync logic), `fetch` (the GitHub API).
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getConfig, getTypedConfig } from '../src/lib/configManager';
import { registerFeedbackSyncScheduler } from '../src/lib/feedbackSyncScheduler';
import { createNotification } from '../src/lib/notifications';

vi.mock('../src/lib/configManager', () => ({
  getConfig: vi.fn(),
  getTypedConfig: vi.fn(),
}));

vi.mock('../src/lib/notifications', () => ({
  createNotification: vi.fn(),
}));

vi.mock('../src/lib/schedulerLock', () => ({
  withSchedulerLock: (_prisma: unknown, _name: unknown, tick: () => Promise<unknown>) => tick,
}));

vi.mock('../src/lib/maintenanceMode', () => ({
  guardMaintenance: (_prisma: unknown, tick: () => Promise<unknown>) => tick,
}));

/** Fires regardless of the configured interval — see the module's own `setTimeout(..., 60_000)`. */
const INITIAL_DELAY_MS = 60_000;
const TEST_INTERVAL_MS = 3_600_000;

function buildFakePrisma(submissions: unknown[]) {
  return {
    feedbackSubmission: {
      findMany: vi.fn(async () => submissions),
      update: vi.fn(async () => ({})),
    },
  } as any;
}

function buildSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    issueNumber: 42,
    issueUrl: 'https://github.com/luke-org/luke/issues/42',
    repo: 'luke-org/luke',
    status: 'open',
    commentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockGitHubIssue(
  overrides: Partial<{ ok: boolean; state: 'open' | 'closed'; comments: number; html_url: string }> = {}
) {
  const { ok = true, state = 'open', comments = 0, html_url = 'https://github.com/luke-org/luke/issues/42' } = overrides;
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    json: async () => ({ state, comments, html_url }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('feedbackSyncScheduler', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getTypedConfig).mockResolvedValue(TEST_INTERVAL_MS);
    vi.mocked(getConfig).mockResolvedValue('ghp_test_token');
  });

  afterEach(async () => {
    await fastify?.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function runFirstTick(prisma: ReturnType<typeof buildFakePrisma>) {
    fastify = Fastify({ logger: false });
    registerFeedbackSyncScheduler(fastify, prisma);
    await fastify.ready();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
  }

  it('senza token configurato non chiama GitHub né legge le submission', async () => {
    vi.mocked(getConfig).mockResolvedValue(null);
    const fetchMock = mockGitHubIssue();
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.feedbackSubmission.findMany).not.toHaveBeenCalled();
  });

  it('interroga solo le submission con status=open', async () => {
    mockGitHubIssue();
    const prisma = buildFakePrisma([]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.findMany).toHaveBeenCalledWith({ where: { status: 'open' } });
  });

  it('nuovo commento (comments > commentCount) → notifica "nuova risposta" e aggiorna solo commentCount', async () => {
    const submission = buildSubmission({ commentCount: 1 });
    const fetchMock = mockGitHubIssue({ state: 'open', comments: 3 });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/${submission.repo}/issues/${submission.issueNumber}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test_token' }),
      })
    );
    // Plausible bug: flipping status to "closed" (or anything but the real GitHub state)
    // on a comment-only update, when the issue is still open.
    expect(prisma.feedbackSubmission.update).toHaveBeenCalledWith({
      where: { id: submission.id },
      data: { status: 'open', commentCount: 3 },
    });
    expect(createNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: submission.userId,
        category: 'SYSTEM',
        data: { issueNumber: submission.issueNumber, type: 'feedback_comment' },
      })
    );
  });

  it('issue appena chiusa (open→closed) → notifica di chiusura anche senza nuovi commenti', async () => {
    const submission = buildSubmission({ status: 'open', commentCount: 2 });
    mockGitHubIssue({ state: 'closed', comments: 2 });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.update).toHaveBeenCalledWith({
      where: { id: submission.id },
      data: { status: 'closed', commentCount: 2 },
    });
    expect(createNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        data: { issueNumber: submission.issueNumber, type: 'feedback_closed' },
      })
    );
  });

  it('nessuna novità (stesso stato, stesso commentCount) → nessun update, nessuna notifica', async () => {
    const submission = buildSubmission({ status: 'open', commentCount: 3 });
    mockGitHubIssue({ state: 'open', comments: 3 });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.update).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('una submission già chiusa altrove (status=closed) non viene nemmeno interrogata', async () => {
    const fetchMock = mockGitHubIssue();
    // findMany è mockato per restituire solo ciò che il where richiede: qui verifichiamo
    // che il filtro sia effettivamente applicato, non solo dichiarato.
    const prisma = buildFakePrisma([]);
    prisma.feedbackSubmission.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'open' ? [] : [buildSubmission({ status: 'closed' })]
    );

    await runFirstTick(prisma);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una submission che fallisce (errore di rete) non blocca la sync delle altre nello stesso tick', async () => {
    const failing = buildSubmission({ id: 'sub-fail', issueNumber: 1 });
    const ok = buildSubmission({ id: 'sub-ok', issueNumber: 2, commentCount: 0 });
    const prisma = buildFakePrisma([failing, ok]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/issues/1')) throw new Error('network error');
        return { ok: true, status: 200, json: async () => ({ state: 'open', comments: 1, html_url: 'x' }) };
      })
    );

    await runFirstTick(prisma);

    // Plausible bug: un errore non catturato per-item interrompe il `for` e la
    // submission successiva non viene mai sincronizzata.
    expect(prisma.feedbackSubmission.update).toHaveBeenCalledTimes(1);
    expect(prisma.feedbackSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-ok' },
      data: { status: 'open', commentCount: 1 },
    });
  });

  it('issue non raggiungibile (GitHub 404/401) → nessun update, nessuna notifica, nessuna eccezione propagata', async () => {
    mockGitHubIssue({ ok: false });
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.update).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('se la lettura dell\'intervallo da AppConfig fallisce, il primo tick parte comunque dopo 60s', async () => {
    vi.mocked(getTypedConfig).mockRejectedValue(new Error('config non trovata'));
    mockGitHubIssue();
    const prisma = buildFakePrisma([]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.findMany).toHaveBeenCalledTimes(1);
  });
});
