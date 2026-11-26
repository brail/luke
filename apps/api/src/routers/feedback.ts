import { TRPCError } from '@trpc/server';

import { FeedbackSubmitInputSchema, GitHubCreatedIssueSchema, fullName } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getTypedConfig } from '../lib/configManager';
import { notifyAdmins } from '../lib/notifications';
import { PERSON_REFERENCE_SELECT } from '../lib/personReference';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const LABEL_MAP = { bug: ['bug'], feature: ['enhancement'] } as const;

/** The administrators' notice of a new report, by type. */
const NOTICE = {
  bug: { title: 'Nuova segnalazione di bug', verb: 'ha segnalato un bug' },
  feature: { title: 'Nuovo suggerimento', verb: 'ha inviato un suggerimento' },
} as const;

export const feedbackRouter = router({
  /**
   * Submits a bug report or feature request as a GitHub issue using the configured feedback token.
   *
   * @auth {authenticated}
   * @input {FeedbackSubmitInputSchema} — feedback type, title and description.
   * @output {{ issueNumber: number }}
   */
  // nosemgrep: luke-procedure-requires-permission -- any signed-in user may report a problem; rate-limited, and the GitHub token is the server's
  submit: protectedProcedure
    .use(withRateLimit('configMutations'))
    .input(FeedbackSubmitInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [token, repo] = await Promise.all([
        getTypedConfig(ctx.prisma, 'integrations.github.feedbackToken'),
        getTypedConfig(ctx.prisma, 'integrations.github.feedbackRepo'),
      ]).catch(() => {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Feedback non configurato. Contatta un amministratore.',
        });
      });

      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: PERSON_REFERENCE_SELECT,
      });
      const name = fullName(user ?? ctx.session.user);
      const body = [input.description, '', `---`, `Inviato da: ${name}`].join('\n');

      const failed = () =>
        new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore nella creazione della segnalazione. Riprova.',
        });

      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        signal: AbortSignal.timeout(10_000),
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          body,
          labels: LABEL_MAP[input.type],
        }),
      }).catch((err: unknown) => {
        ctx.logger.error({ err, repo }, 'GitHub issue creation failed');
        throw failed();
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        ctx.logger.error(
          { status: res.status, repo, body: errorBody },
          'GitHub issue creation failed',
        );
        throw failed();
      }

      const parsed = GitHubCreatedIssueSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) {
        ctx.logger.error({ repo, issues: parsed.error.issues }, 'GitHub issue creation: answer not understood');
        throw failed();
      }
      const issue = parsed.data;

      await ctx.prisma.feedbackSubmission.create({
        data: {
          userId: ctx.session.user.id,
          issueNumber: issue.number,
          issueUrl: issue.html_url,
          repo,
          // Tracked by comment id from the start; only older rows fall back to the count once.
          commentIdsTrackedAt: new Date(),
        },
      });

      await logAudit(ctx, {
        action: 'FEEDBACK_SUBMIT',
        targetType: 'Feedback',
        targetId: String(issue.number),
        result: 'SUCCESS',
        metadata: { type: input.type, title: input.title },
      });

      // After the submission is recorded; a failed notice never costs it.
      await notifyAdmins(
        ctx.prisma,
        {
          category: 'SYSTEM',
          title: NOTICE[input.type].title,
          message: `${name} ${NOTICE[input.type].verb} (#${issue.number}): «${input.title}»`,
          data: { type: 'feedback_submitted', issueNumber: issue.number },
        },
        ctx.session.user.id
      ).catch(err => ctx.logger.error({ err, issueNumber: issue.number }, 'Failed to notify admins of new feedback'));

      return { issueNumber: issue.number };
    }),
});
