import { TRPCError } from '@trpc/server';

import { FeedbackSubmitInputSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getTypedConfig } from '../lib/configManager';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const LABEL_MAP = { bug: ['bug'], feature: ['enhancement'] } as const;

export const feedbackRouter = router({
  /**
   * Submits a bug report or feature request as a GitHub issue using the configured feedback token.
   *
   * @auth {authenticated}
   * @input {FeedbackSubmitInputSchema} — feedback type, title and description.
   * @output {{ issueUrl: string, issueNumber: number }}
   */
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
        select: { firstName: true, lastName: true, email: true },
      });
      const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || ctx.session.user.email;
      const body = [
        input.description,
        '',
        `---`,
        `Inviato da: ${displayName} (${user?.email ?? ctx.session.user.email})`,
      ].join('\n');

      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
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
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        ctx.logger.error(
          { status: res.status, repo, body: errorBody },
          'GitHub issue creation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore nella creazione della segnalazione. Riprova.',
        });
      }

      const issue = await res.json() as { html_url: string; number: number };

      await ctx.prisma.feedbackSubmission.create({
        data: {
          userId: ctx.session.user.id,
          issueNumber: issue.number,
          issueUrl: issue.html_url,
          repo,
        },
      });

      await logAudit(ctx, {
        action: 'FEEDBACK_SUBMIT',
        targetType: 'Feedback',
        targetId: String(issue.number),
        result: 'SUCCESS',
        metadata: { type: input.type, title: input.title },
      });

      return { issueUrl: issue.html_url, issueNumber: issue.number };
    }),
});
