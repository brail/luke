import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import { getConfig } from '../lib/configManager';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const LABEL_MAP = { bug: ['bug'], feature: ['enhancement'] } as const;

export const feedbackRouter = router({
  submit: protectedProcedure
    .use(withRateLimit('configMutations'))
    .input(z.object({
      type: z.enum(['bug', 'feature']),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const [token, repo] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.github.feedbackToken', true),
        getConfig(ctx.prisma, 'integrations.github.feedbackRepo', false),
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore nella creazione della segnalazione. Riprova.',
        });
      }

      const issue = await res.json() as { html_url: string; number: number };

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
