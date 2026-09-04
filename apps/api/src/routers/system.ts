import { CalendarDigestRangeInputSchema } from '@luke/core';

import { runDigestNow } from '../lib/calendarDigestScheduler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

export const systemRouter = router({
  /**
   * Manually triggers the calendar phase-alert digest email for a given date range, outside its
   * normal cron schedule — used for testing/re-sending. See `runDigestNow`.
   *
   * @auth {season_calendar:read}
   * @input {CalendarDigestRangeInputSchema} — inclusive date range as `YYYY-MM-DD` strings.
   * @output {{ ok: true }}
   */
  triggerCalendarDigest: protectedProcedure
    // Re-sending your own calendar digest is a calendar action, not a configuration change. It was
    // the only legitimate editor flow behind `config:update`.
    .use(requirePermission('season_calendar:read'))
    .input(CalendarDigestRangeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const range = {
        start: new Date(`${input.from}T00:00:00`),
        end: new Date(new Date(`${input.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000),
      };
      await runDigestNow(ctx.prisma, ctx.logger, range, ctx.session.user.id);
      return { ok: true };
    }),
});
