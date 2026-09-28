import { CalendarDigestRangeInputSchema } from '@luke/core';

import { runDigestNow } from '../lib/calendarDigestScheduler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

export const systemRouter = router({
  /**
   * Sends the caller their own calendar digest (the AuditLog change recap) for a date range, outside
   * the scheduled 07:00 run — used for testing/re-sending. It bypasses the caller's CALENDAR opt-out
   * and records no delivery row. See `runDigestNow`.
   *
   * @auth {season_calendar:read}
   * @input {CalendarDigestRangeInputSchema} — inclusive range of calendar dates (`YYYY-MM-DD`), read in
   *   the caller's zone.
   * @output {{ ok: true }}
   */
  triggerCalendarDigest: protectedProcedure
    // Re-sending your own calendar digest is a calendar action, not a configuration change. It was
    // the only legitimate editor flow behind `config:update`.
    .use(requirePermission('season_calendar:read'))
    .input(CalendarDigestRangeInputSchema)
    .mutation(async ({ input, ctx }) => {
      await runDigestNow(ctx.prisma, ctx.logger, input, ctx.session.user.id);
      return { ok: true };
    }),
});
