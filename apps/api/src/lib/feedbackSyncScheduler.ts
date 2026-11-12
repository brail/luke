import { GitHubIssueCommentPageSchema, GitHubIssueSchema } from '@luke/core';
import type { PrismaClient, FeedbackSubmission } from '@luke/db';

import { getConfig, getTypedConfig } from './configManager';
import { guardMaintenance } from './maintenanceMode';
import { pingRecipients, recipientsOf, writeNotifications, type NotificationRow } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { FastifyInstance } from 'fastify';

type Logger = FastifyInstance['log'];

const GITHUB_API_ORIGIN = 'https://api.github.com';

function getGitHub(url: string, token: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

/** One `<url>; rel="…"` entry of a `Link` header, as GitHub writes it. */
const LINK_ENTRY = /^\s*<([^<>]+)>\s*;\s*rel="([^"]+)"\s*$/;

/**
 * The page after this one, from GitHub's `Link` header; null on the last page (no header, or no
 * `rel="next"`). Throws on a header it cannot read, and on a next URL already fetched or outside
 * `https://api.github.com`: the token goes to that URL.
 */
function nextPage(link: string | null, fetched: Set<string>): string | null {
  if (link === null) return null;
  for (const entry of link.split(',')) {
    const [, url, rel] = LINK_ENTRY.exec(entry) ?? [];
    if (url === undefined) throw new Error('malformed Link header');
    if (rel !== 'next') continue;
    if (new URL(url).origin !== GITHUB_API_ORIGIN) throw new Error('next page outside the GitHub API');
    if (fetched.has(url)) throw new Error('next page already fetched');
    return url;
  }
  return null;
}

/**
 * Every comment id of the submission's issue, page by page (`nextPage`). Null, logged, when any page
 * cannot be read or understood: a partial list is never used.
 */
async function readCommentIds(token: string, submission: FeedbackSubmission, logger: Logger): Promise<bigint[] | null> {
  const ids: bigint[] = [];
  const fetched = new Set<string>();
  let url: string | null = `${GITHUB_API_ORIGIN}/repos/${submission.repo}/issues/${submission.issueNumber}/comments?per_page=100`;
  try {
    while (url !== null) {
      fetched.add(url);
      const res = await getGitHub(url, token);
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      ids.push(...GitHubIssueCommentPageSchema.parse(await res.json()).map(c => BigInt(c.id)));
      url = nextPage(res.headers.get('link'), fetched);
    }
  } catch (err) {
    logger.warn({ err, issueNumber: submission.issueNumber, repo: submission.repo }, 'Feedback sync: cannot read the GitHub comments');
    return null;
  }
  return ids;
}

/**
 * Syncs one open submission with its GitHub issue and notifies the submitter of a reply (a comment
 * id not in `seenCommentIds`; by count on a row's first tick without `commentIdsTrackedAt`) or of
 * the close. Exported for the integration test.
 */
export async function syncSubmission(
  prisma: PrismaClient,
  token: string,
  submission: FeedbackSubmission,
  logger: Logger,
): Promise<void> {
  const res = await getGitHub(`${GITHUB_API_ORIGIN}/repos/${submission.repo}/issues/${submission.issueNumber}`, token);

  if (!res.ok) {
    logger.warn(
      { status: res.status, issueNumber: submission.issueNumber, repo: submission.repo },
      'Feedback sync: cannot read GitHub issue',
    );
    return;
  }

  const parsed = GitHubIssueSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    logger.warn(
      { issueNumber: submission.issueNumber, repo: submission.repo, issues: parsed.error.issues },
      'Feedback sync: GitHub answer not understood',
    );
    return;
  }
  const issue = parsed.data;

  // Nothing to read when the issue is closed (monitoring ends, the close is the notice), or has no
  // comment and none was seen before.
  const ids = issue.state === 'closed' || (issue.comments === 0 && submission.seenCommentIds.length === 0)
    ? []
    : await readCommentIds(token, submission, logger);
  if (ids === null) return;

  const seen = new Set(submission.seenCommentIds);
  const tracked = submission.commentIdsTrackedAt !== null;
  // Only grows: an id absent from this read (deleted, or shifted out between pages) stays seen.
  const seenCommentIds = [...new Set([...seen, ...ids])];
  const grew = seenCommentIds.length > seen.size;
  if (tracked && !grew && issue.state === submission.status && issue.comments === submission.commentCount) return;

  const justClosed = issue.state === 'closed' && submission.status === 'open';
  const replied = tracked ? grew : issue.comments > submission.commentCount;
  const notify = (justClosed || replied) && (await recipientsOf(prisma, [submission.userId], 'SYSTEM')).length > 0;
  const { title, message, type } = justClosed
    ? { title: 'Segnalazione chiusa', message: `La tua segnalazione #${submission.issueNumber} è stata chiusa`, type: 'feedback_closed' }
    : { title: 'Nuova risposta alla tua segnalazione', message: `C'è una nuova risposta sulla tua segnalazione #${submission.issueNumber}`, type: 'feedback_comment' };
  const notices: NotificationRow[] = notify
    ? [{ userId: submission.userId, category: 'SYSTEM', title, message, link: issue.html_url, data: { issueNumber: submission.issueNumber, type } }]
    : [];

  // One transaction: a failure leaves the row and the notices as they were, retried whole next tick.
  // The update goes first, on the row version scanned only: if another instance synced it meanwhile
  // (the scheduler lock can expire mid-scan), nothing is written and nothing notified twice.
  const notified = await prisma.$transaction(async tx => {
    const { count } = await tx.feedbackSubmission.updateMany({
      where: { id: submission.id, updatedAt: submission.updatedAt },
      data: {
        status: issue.state,
        commentCount: issue.comments,
        seenCommentIds,
        commentIdsTrackedAt: submission.commentIdsTrackedAt ?? new Date(),
      },
    });
    return count === 1 && (await writeNotifications(tx, notices));
  });
  if (notified) pingRecipients(notices);
}

async function checkFeedback(prisma: PrismaClient, logger: Logger): Promise<void> {
  const token = await getConfig(prisma, 'integrations.github.feedbackToken');
  if (!token) return;

  const openSubmissions = await prisma.feedbackSubmission.findMany({ where: { status: 'open' } });

  for (const submission of openSubmissions) {
    try {
      await syncSubmission(prisma, token, submission, logger);
    } catch (err) {
      logger.error({ err, issueNumber: submission.issueNumber }, 'Feedback sync: tick failed for one submission');
    }
  }
}

/**
 * Registers the feedback sync scheduler as a Fastify plugin. Polls open `FeedbackSubmission`
 * rows against the GitHub API on a tick whose interval is read once at registration from
 * `integrations.github.feedbackSyncIntervalMs` (default 24h, see seed.ts) — changing the config
 * value requires an API restart to take effect, same as every other scheduler in this directory.
 * Creates an in-app SYSTEM notification for the submitter when the issue gets a new comment or
 * is closed, since the submitter has no GitHub account of their own to watch it (`syncSubmission`).
 *
 * Monitoring ends when the issue is first seen closed: a reopened issue is not followed, and a reply
 * missed by the last scan before the close is not notified.
 */
export function registerFeedbackSyncScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const guardedCheck = guardMaintenance(prisma, withSchedulerLock(prisma, 'feedback-sync', () => checkFeedback(prisma, fastify.log)));
  const run = () =>
    guardedCheck().catch(err =>
      fastify.log.error({ err }, 'Feedback sync check failed')
    );

  fastify.addHook('onReady', async () => {
    const intervalMs = await getTypedConfig(prisma, 'integrations.github.feedbackSyncIntervalMs').catch(() => 24 * 60 * 60 * 1000);
    fastify.log.info({ intervalMs }, 'Feedback sync scheduler: started');
    setTimeout(() => void run(), 60_000);
    timer = setInterval(() => void run(), intervalMs);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Feedback sync scheduler: stopped');
  });
}
