import { getConfig, getTypedConfig } from './configManager';
import { guardMaintenance } from './maintenanceMode';
import { createNotification } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { PrismaClient, FeedbackSubmission } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

interface GitHubIssue {
  state: 'open' | 'closed';
  comments: number;
  html_url: string;
}

async function syncSubmission(
  prisma: PrismaClient,
  token: string,
  submission: FeedbackSubmission,
  logger: FastifyInstance['log'],
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${submission.repo}/issues/${submission.issueNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    logger.warn(
      { status: res.status, issueNumber: submission.issueNumber, repo: submission.repo },
      'Feedback sync: impossibile leggere issue GitHub',
    );
    return;
  }

  const issue = await res.json() as GitHubIssue;
  const justClosed = issue.state === 'closed' && submission.status === 'open';
  const hasNewComments = issue.comments > submission.commentCount;
  if (!justClosed && !hasNewComments) return;

  await prisma.feedbackSubmission.update({
    where: { id: submission.id },
    data: { status: issue.state, commentCount: issue.comments },
  });

  await createNotification(prisma, {
    userId: submission.userId,
    category: 'SYSTEM',
    title: justClosed ? 'Segnalazione chiusa' : 'Nuova risposta alla tua segnalazione',
    message: justClosed
      ? `La tua segnalazione #${submission.issueNumber} è stata chiusa`
      : `C'è una nuova risposta sulla tua segnalazione #${submission.issueNumber}`,
    link: issue.html_url,
    data: { issueNumber: submission.issueNumber, type: justClosed ? 'feedback_closed' : 'feedback_comment' },
  });
}

async function checkFeedback(prisma: PrismaClient, logger: FastifyInstance['log']): Promise<void> {
  const token = await getConfig(prisma, 'integrations.github.feedbackToken', true);
  if (!token) return;

  const openSubmissions = await prisma.feedbackSubmission.findMany({ where: { status: 'open' } });

  for (const submission of openSubmissions) {
    try {
      await syncSubmission(prisma, token, submission, logger);
    } catch (err) {
      logger.error({ err, issueNumber: submission.issueNumber }, 'Feedback sync: tick fallito per una submission');
    }
  }
}

/**
 * Registers the feedback sync scheduler as a Fastify plugin. Polls open `FeedbackSubmission`
 * rows against the GitHub API on a tick whose interval is read once at registration from
 * `integrations.github.feedbackSyncIntervalMs` (default 24h, see seed.ts) — changing the config
 * value requires an API restart to take effect, same as every other scheduler in this directory.
 * Creates an in-app SYSTEM notification for the submitter when the issue gets a new comment or
 * is closed, since the submitter has no GitHub account of their own to watch it.
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
    fastify.log.info({ intervalMs }, 'Feedback sync scheduler: avviato');
    setTimeout(() => void run(), 60_000);
    timer = setInterval(() => void run(), intervalMs);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Feedback sync scheduler: fermato');
  });
}
