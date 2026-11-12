/**
 * Unit tests for the orchestration of `feedbackSyncScheduler.ts`: which
 * submissions get polled, when a GitHub issue update turns into a
 * notification (a comment id not seen before, the count on a row's first
 * tick, the close), how the comment pages are followed, and that one
 * submission's failure doesn't block the others in the same tick.
 *
 * Mocked: `configManager` (token/interval are inputs, not what's tested),
 * `notifications` (only what is written and pinged, not the preference logic
 * — covered elsewhere), `schedulerLock`/`maintenanceMode` (covered by their
 * own suites), `fetch` (the GitHub API), Prisma (the transaction's atomicity
 * and the stale-row guard against a real database are in
 * `feedbackSync.integration.spec.ts`).
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getConfig, getTypedConfig } from '../src/lib/configManager';
import { registerFeedbackSyncScheduler } from '../src/lib/feedbackSyncScheduler';
import { pingRecipients, recipientsOf, writeNotifications } from '../src/lib/notifications';

vi.mock('../src/lib/configManager', () => ({
  getConfig: vi.fn(),
  getTypedConfig: vi.fn(),
}));

vi.mock('../src/lib/notifications', () => ({
  recipientsOf: vi.fn(),
  writeNotifications: vi.fn(),
  pingRecipients: vi.fn(),
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

const REPO = 'luke-org/luke';
const ISSUE_URL = `https://api.github.com/repos/${REPO}/issues/42`;
const COMMENTS_URL = `${ISSUE_URL}/comments?per_page=100`;
const PAGE_2_URL = `https://api.github.com/repositories/1/issues/42/comments?per_page=100&page=2`;
const HTML_URL = 'https://github.com/luke-org/luke/issues/42';

function buildFakePrisma(submissions: unknown[], updatedRows = 1) {
  const tx = { feedbackSubmission: { updateMany: vi.fn(async () => ({ count: updatedRows })) } };
  return {
    tx,
    feedbackSubmission: { findMany: vi.fn(async () => submissions) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as any;
}

function buildSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    userId: 'user-1',
    issueNumber: 42,
    issueUrl: HTML_URL,
    repo: REPO,
    status: 'open',
    commentCount: 0,
    seenCommentIds: [] as bigint[],
    commentIdsTrackedAt: new Date('2026-11-01T00:00:00Z') as Date | null,
    createdAt: new Date(),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    ...overrides,
  };
}

/** One comments page: the ids it lists (or a raw body), its `Link` header, its status. */
interface Page {
  ids?: number[];
  body?: string;
  link?: string;
  status?: number;
}

/**
 * Stubs GitHub: the issue at `ISSUE_URL` (any issue number), and the comment pages by URL — a URL
 * not listed answers 404.
 */
function mockGitHub(
  issue: Partial<{ ok: boolean; state: 'open' | 'closed'; comments: number; html_url: string }> = {},
  pages: Record<string, Page> = {}
) {
  const { ok = true, state = 'open', comments = 0, html_url = HTML_URL } = issue;
  const fetchMock = vi.fn(async (url: string, _init?: { signal: AbortSignal; headers: Record<string, string> }) => {
    if (url.includes('/comments')) {
      const page = pages[url];
      if (!page) return new Response('{}', { status: 404 });
      return new Response(page.body ?? JSON.stringify((page.ids ?? []).map(id => ({ id }))), {
        status: page.status ?? 200,
        headers: page.link ? { link: page.link } : {},
      });
    }
    return new Response(JSON.stringify({ state, comments, html_url }), { status: ok ? 200 : 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The comments of the issue on a single page. */
const onePage = (ids: number[]) => ({ [COMMENTS_URL]: { ids } });

describe('feedbackSyncScheduler', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getTypedConfig).mockResolvedValue(TEST_INTERVAL_MS);
    vi.mocked(getConfig).mockResolvedValue('ghp_test_token');
    vi.mocked(recipientsOf).mockImplementation(async (_prisma, userIds) => userIds);
    vi.mocked(writeNotifications).mockImplementation(async (_db, rows) => rows.length > 0);
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

  function expectStored(prisma: ReturnType<typeof buildFakePrisma>, submission: ReturnType<typeof buildSubmission>, data: Record<string, unknown>) {
    expect(prisma.tx.feedbackSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: submission.id, updatedAt: submission.updatedAt },
      data: { commentIdsTrackedAt: submission.commentIdsTrackedAt, ...data },
    });
  }

  function expectNotice(prisma: ReturnType<typeof buildFakePrisma>, type: 'feedback_comment' | 'feedback_closed') {
    const notice = expect.objectContaining({ userId: 'user-1', category: 'SYSTEM', link: HTML_URL, data: { issueNumber: 42, type } });
    expect(writeNotifications).toHaveBeenCalledWith(prisma.tx, [notice]);
    expect(pingRecipients).toHaveBeenCalledWith([notice]);
  }

  function expectNoNotice() {
    expect(vi.mocked(writeNotifications).mock.calls.flatMap(([, rows]) => rows)).toEqual([]);
    expect(pingRecipients).not.toHaveBeenCalled();
  }

  function expectNothingWritten(prisma: ReturnType<typeof buildFakePrisma>) {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(pingRecipients).not.toHaveBeenCalled();
  }

  it('with no token configured it neither calls GitHub nor reads the submissions', async () => {
    vi.mocked(getConfig).mockResolvedValue(null);
    const fetchMock = mockGitHub();
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.feedbackSubmission.findMany).not.toHaveBeenCalled();
  });

  it('queries only submissions with status=open — monitoring ends at the first close', async () => {
    mockGitHub();
    const prisma = buildFakePrisma([]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.findMany).toHaveBeenCalledWith({ where: { status: 'open' } });
  });

  it('a comment id not seen before → "new reply" notice, ids and count stored', async () => {
    const submission = buildSubmission({ commentCount: 1, seenCommentIds: [1n] });
    const fetchMock = mockGitHub({ comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ISSUE_URL, COMMENTS_URL]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers.Authorization).toBe('Bearer ghp_test_token');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expectStored(prisma, submission, { status: 'open', commentCount: 2, seenCommentIds: [1n, 2n] });
    expectNotice(prisma, 'feedback_comment');
  });

  // #112: a deletion and a reply within one interval leave the count unchanged.
  it('a deletion and a reply with the count unchanged → one notice; the deleted id stays seen', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ comments: 2 }, onePage([1, 3]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 2, seenCommentIds: [1n, 2n, 3n] });
    expectNotice(prisma, 'feedback_comment');
  });

  it('only a deletion → count stored lower, no notice', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ comments: 1 }, onePage([1]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 1, seenCommentIds: [1n, 2n] });
    expectNoNotice();
  });

  it('nothing new (an edit, same ids, same count) → no write, no notice', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectNothingWritten(prisma);
  });

  it('no comment and none seen → the comments are not read', async () => {
    const fetchMock = mockGitHub({ comments: 0 });
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNothingWritten(prisma);
  });

  it('follows rel="next"; an id shifted out between pages stays seen, no notice', async () => {
    const submission = buildSubmission({ commentCount: 4, seenCommentIds: [1n, 2n, 3n, 4n] });
    const fetchMock = mockGitHub({ comments: 4 }, {
      [COMMENTS_URL]: { ids: [1, 2], link: `<${PAGE_2_URL}>; rel="next", <${PAGE_2_URL}>; rel="last"` },
      [PAGE_2_URL]: { ids: [4], link: `<${COMMENTS_URL}>; rel="prev", <${COMMENTS_URL}>; rel="first"` },
    });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ISSUE_URL, COMMENTS_URL, PAGE_2_URL]);
    expectNothingWritten(prisma);
  });

  it('a new id on the second page → notice', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ comments: 3 }, {
      [COMMENTS_URL]: { ids: [1, 2], link: `<${PAGE_2_URL}>; rel="next"` },
      [PAGE_2_URL]: { ids: [3] },
    });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 3, seenCommentIds: [1n, 2n, 3n] });
    expectNotice(prisma, 'feedback_comment');
  });

  it.each([
    ['a malformed Link header', { [COMMENTS_URL]: { ids: [9], link: `${PAGE_2_URL}; rel=next` } }],
    ['a next page already fetched', { [COMMENTS_URL]: { ids: [9], link: `<${COMMENTS_URL}>; rel="next"` } }],
    ['a next page outside the GitHub API', { [COMMENTS_URL]: { ids: [9], link: '<https://evil.example/c?page=2>; rel="next"' } }],
    ['a next page over plain http', { [COMMENTS_URL]: { ids: [9], link: '<http://api.github.com/c?page=2>; rel="next"' } }],
    ['a second page not understood', { [COMMENTS_URL]: { ids: [9], link: `<${PAGE_2_URL}>; rel="next"` }, [PAGE_2_URL]: { body: '{"id":1}' } }],
    ['a second page that fails', { [COMMENTS_URL]: { ids: [9], link: `<${PAGE_2_URL}>; rel="next"` }, [PAGE_2_URL]: { status: 502 } }],
    ['a comment id that is not a safe integer', { [COMMENTS_URL]: { body: '[{"id":9007199254740993}]' } }],
  ])('%s → the scan is refused, nothing written, the token goes nowhere else', async (_case, pages) => {
    const fetchMock = mockGitHub({ comments: 3 }, pages);
    const prisma = buildFakePrisma([buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] })]);

    await runFirstTick(prisma);

    expectNothingWritten(prisma);
    for (const [url] of fetchMock.mock.calls) expect(url.startsWith('https://api.github.com/')).toBe(true);
  });

  it('an id above int32 is kept exact', async () => {
    const submission = buildSubmission({ commentCount: 0 });
    mockGitHub({ comments: 1 }, onePage([Number.MAX_SAFE_INTEGER]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 1, seenCommentIds: [9007199254740991n] });
  });

  it('a row created before id tracking, count unchanged → ids and marker stored, no notice', async () => {
    const submission = buildSubmission({ commentCount: 2, commentIdsTrackedAt: null });
    mockGitHub({ comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 2, seenCommentIds: [1n, 2n], commentIdsTrackedAt: expect.any(Date) });
    expectNoNotice();
  });

  it('a row created before id tracking, count up → notice by the count rule, ids stored', async () => {
    const submission = buildSubmission({ commentCount: 1, commentIdsTrackedAt: null });
    mockGitHub({ comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 2, seenCommentIds: [1n, 2n], commentIdsTrackedAt: expect.any(Date) });
    expectNotice(prisma, 'feedback_comment');
  });

  it('a row created before id tracking with no comment → marker stored without reading comments', async () => {
    const submission = buildSubmission({ commentIdsTrackedAt: null });
    const fetchMock = mockGitHub({ comments: 0 });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectStored(prisma, submission, { status: 'open', commentCount: 0, seenCommentIds: [], commentIdsTrackedAt: expect.any(Date) });
    expectNoNotice();
  });

  it('SYSTEM notifications switched off → ids still stored, no notice', async () => {
    vi.mocked(recipientsOf).mockResolvedValue([]);
    const submission = buildSubmission({ commentCount: 1, seenCommentIds: [1n] });
    mockGitHub({ comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'open', commentCount: 2, seenCommentIds: [1n, 2n] });
    expectNoNotice();
  });

  const CLOSED = 'La tua segnalazione #42 è stata chiusa';
  const CLOSED_WITH_REPLY = `${CLOSED}, con una nuova risposta`;

  function expectCloseMessage(prisma: ReturnType<typeof buildFakePrisma>, message: string) {
    expectNotice(prisma, 'feedback_closed');
    expect(writeNotifications).toHaveBeenCalledWith(prisma.tx, [expect.objectContaining({ title: 'Segnalazione chiusa', message })]);
  }

  it('issue just closed, no new comment → one plain closing notice', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ state: 'closed', comments: 2 }, onePage([1, 2]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'closed', commentCount: 2, seenCommentIds: [1n, 2n] });
    expectCloseMessage(prisma, CLOSED);
  });

  // #112, owner decision 20 a: one notice, the close, that also tells the reply.
  it('a reply and the close in one tick, count unchanged by a deletion → one closing notice that tells the reply', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ state: 'closed', comments: 2 }, onePage([1, 3]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'closed', commentCount: 2, seenCommentIds: [1n, 2n, 3n] });
    expectCloseMessage(prisma, CLOSED_WITH_REPLY);
  });

  it('closed but the comments cannot be read → the close is stored anyway, plain notice', async () => {
    const submission = buildSubmission({ commentCount: 2, seenCommentIds: [1n, 2n] });
    mockGitHub({ state: 'closed', comments: 3 }, { [COMMENTS_URL]: { status: 502 } });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'closed', commentCount: 3, seenCommentIds: [1n, 2n] });
    expectCloseMessage(prisma, CLOSED);
  });

  it('a row created before id tracking, closed with the count up → the count tells the reply, comments not read', async () => {
    const submission = buildSubmission({ commentCount: 1, commentIdsTrackedAt: null });
    const fetchMock = mockGitHub({ state: 'closed', comments: 2 });
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectStored(prisma, submission, { status: 'closed', commentCount: 2, seenCommentIds: [], commentIdsTrackedAt: expect.any(Date) });
    expectCloseMessage(prisma, CLOSED_WITH_REPLY);
  });

  it('closed with comments deleted → closing notice, count stored lower', async () => {
    const submission = buildSubmission({ commentCount: 3, seenCommentIds: [1n, 2n, 3n] });
    mockGitHub({ state: 'closed', comments: 1 }, onePage([1]));
    const prisma = buildFakePrisma([submission]);

    await runFirstTick(prisma);

    expectStored(prisma, submission, { status: 'closed', commentCount: 1, seenCommentIds: [1n, 2n, 3n] });
    expectCloseMessage(prisma, CLOSED);
  });

  it('the row changed since the scan (stale guard) → no notice', async () => {
    mockGitHub({ comments: 1 }, onePage([1]));
    const prisma = buildFakePrisma([buildSubmission()], 0);

    await runFirstTick(prisma);

    expectNoNotice();
  });

  it('a failed write → no ping', async () => {
    mockGitHub({ comments: 1 }, onePage([1]));
    vi.mocked(writeNotifications).mockRejectedValueOnce(new Error('insert failed'));
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expect(pingRecipients).not.toHaveBeenCalled();
  });

  it('a submission already closed elsewhere (status=closed) is not even queried', async () => {
    const fetchMock = mockGitHub();
    // findMany is mocked to return only what the where asks for: here we check
    // that the filter is actually applied, not just declared.
    const prisma = buildFakePrisma([]);
    prisma.feedbackSubmission.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'open' ? [] : [buildSubmission({ status: 'closed' })]
    );

    await runFirstTick(prisma);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failing submission (network error) does not block the sync of the others in the same tick', async () => {
    const failing = buildSubmission({ id: 'sub-fail', issueNumber: 1 });
    const ok = buildSubmission();
    const prisma = buildFakePrisma([failing, ok]);
    // The first call is the failing submission's issue.
    mockGitHub({ comments: 1 }, onePage([1])).mockRejectedValueOnce(new Error('network error'));

    await runFirstTick(prisma);

    // Plausible bug: an error not caught per item breaks the `for`, and the
    // next submission is never synced.
    expect(prisma.tx.feedbackSubmission.updateMany).toHaveBeenCalledTimes(1);
    expectStored(prisma, ok, { status: 'open', commentCount: 1, seenCommentIds: [1n] });
  });

  it('an answer that is not an issue, or links outside https → nothing written', async () => {
    mockGitHub({ comments: 1, html_url: 'javascript:alert(1)' }, onePage([1]));
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expectNothingWritten(prisma);
  });

  it('unreachable issue (GitHub 404/401) → nothing written, no exception propagated', async () => {
    mockGitHub({ ok: false });
    const prisma = buildFakePrisma([buildSubmission()]);

    await runFirstTick(prisma);

    expectNothingWritten(prisma);
  });

  it('if reading the interval from AppConfig fails, the first tick still starts after 60s', async () => {
    vi.mocked(getTypedConfig).mockRejectedValue(new Error('config not found'));
    mockGitHub();
    const prisma = buildFakePrisma([]);

    await runFirstTick(prisma);

    expect(prisma.feedbackSubmission.findMany).toHaveBeenCalledTimes(1);
  });
});
