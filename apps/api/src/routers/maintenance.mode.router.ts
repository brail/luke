/**
 * tRPC router for standalone maintenance mode (INACTIVE -> SCHEDULED -> ACTIVE -> INACTIVE).
 *
 * `getStatus` needs a session and nothing more (`sessionProcedure`, ADR-042): nothing before sign-in
 * tells the app's state, and a signed-in user who cannot bypass maintenance still reads it during
 * the window, when every other procedure refuses them. Every mutation requires `maintenance:mode_manage` on `protectedProcedure`, so the maintenance
 * guard runs first: while maintenance is active only whoever bypasses it (`maintenance:update`)
 * reaches them — the admin who has to end it.
 */

import { TRPCError } from '@trpc/server';

import {
  DEFAULT_LOCALE,
  formatInstant,
  MaintenanceModeActivateInputSchema,
  MaintenanceModeScheduleInputSchema,
  MaintenanceModeViewSchema,
} from '@luke/core';

import { APPROVED_USER_WHERE } from '../lib/approvedUsers';
import { logAudit } from '../lib/auditLog';
import { getConfigOrDefault } from '../lib/configManager';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { sendBulkEmail, sendMaintenanceEndedEmail, sendMaintenanceScheduledEmail } from '../lib/mailer';
import {
  DEFAULT_STATE,
  forceLogoutNonAdmins,
  getMaintenanceState,
  transitionMaintenanceState,
  writeMaintenanceState,
} from '../lib/maintenanceMode';
import { bulkNotify } from '../lib/notifications';
import { requirePermission } from '../lib/permissions';
import { protectedProcedure, router, sessionProcedure } from '../lib/trpc';
import { groupByTimeZone } from '../lib/userTimeZone';

import type { Context } from '../lib/trpc';

/** Resolves the app base URL used in email CTAs — same fallback used elsewhere for local dev. */
async function getBaseUrl(ctx: Context): Promise<string> {
  return getConfigOrDefault(ctx.prisma, 'app.baseUrl');
}

/**
 * Fire-and-forget fan-out of `send` to `recipients` (via `sendBulkEmail`) — the admin's mutation
 * response shouldn't block on however long SMTP takes for a potentially large user base.
 * Failures are logged in aggregate, never thrown.
 */
function emailUsers<T>(ctx: Context, recipients: T[], send: (recipient: T) => Promise<void>): void {
  void sendBulkEmail(recipients, send)
    .then(({ failed }) => {
      if (failed > 0) ctx.logger.error({ failed, total: recipients.length }, 'Maintenance mode: email send failed for some users');
    })
    .catch(err => ctx.logger.error({ err }, 'Maintenance mode: email send failed'));
}

export const maintenanceModeRouter = router({
  /**
   * Returns the current maintenance-mode state to any signed-in user, during maintenance too: only
   * what the lock screen, the banner and the maintenance page read. The output schema strips every
   * other stored field.
   *
   * @auth {authenticated — maintenance-exempt (ADR-042)}
   * @input None
   * @output `MaintenanceModeView` — `{ status, scheduledAt, activatedAt, message, warningsSent }`.
   */
  // nosemgrep: luke-procedure-requires-permission -- every signed-in user reads the window's state: the lock screen needs it while maintenance refuses everything else (ADR-042)
  getStatus: sessionProcedure
    .output(MaintenanceModeViewSchema)
    .query(({ ctx }) => getMaintenanceState(ctx.prisma)),

  /**
   * Schedules maintenance mode to activate at a future time, with a warning ladder
   * (in-app notification + SSE push) at each `warningLeadMinutes` threshold beforehand.
   * Can be called again while already `SCHEDULED` to reschedule; refused with `BAD_REQUEST` while
   * `ACTIVE` (end it first).
   *
   * @auth {maintenance:mode_manage}
   * @input `{ scheduledAt, message?, forceLogout, warningLeadMinutes, notifyByEmail }`
   * @output The updated `MaintenanceModeState` (status `SCHEDULED`).
   */
  schedule: protectedProcedure
    .use(requirePermission('maintenance:mode_manage'))
    .input(MaintenanceModeScheduleInputSchema)
    .use(withIdempotency())
    .mutation(async ({ ctx, input }) => {
      // Checked here, after the idempotency middleware: a replay of an accepted schedule returns
      // its stored answer even once `scheduledAt` has passed; a new request must still be ahead.
      if (new Date(input.scheduledAt).getTime() <= Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'La data pianificata deve essere nel futuro' });
      }
      // A threshold farther out than the total time available can never fire as a real
      // "advance warning" — e.g. scheduling for 5 minutes from now, the "15 minutes before"
      // threshold is already in the past and would fire immediately, lumped in with the others.
      // Unreachable ones are discarded instead of letting them all fire together on the first tick.
      // Rounded up: latency between client and server shouldn't cause a threshold the admin
      // clearly intended to include to be dropped by a hair (e.g. "in 5 minutes" with
      // threshold "5" shouldn't be skipped just because 300ms have passed in the meantime).
      const totalLeadMinutes = Math.ceil((new Date(input.scheduledAt).getTime() - Date.now()) / 60_000);
      const warningLeadMinutes = input.warningLeadMinutes.filter(t => t <= totalLeadMinutes);

      // A schedule replaces an earlier one, never an active maintenance (#248): that would reopen
      // the instance, a restore's lockdown included. Checked under the write lock.
      const scheduled = await transitionMaintenanceState(ctx.prisma, current =>
        current.status === 'ACTIVE'
          ? null
          : {
              status: 'SCHEDULED',
              scheduledAt: input.scheduledAt,
              activatedAt: null,
              message: input.message ?? null,
              forceLogout: input.forceLogout,
              warningLeadMinutes,
              warningsSent: [],
              activatedByUserId: ctx.session.user.id,
              notifyByEmail: input.notifyByEmail,
            }
      );
      if (!scheduled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "La modalità manutenzione è attiva: terminala prima di pianificarne un'altra",
        });
      }
      const state = scheduled.next;

      // A single query of the approved users, reused for both the in-app notification and the
      // optional email.
      const users = await ctx.prisma.user.findMany({ where: APPROVED_USER_WHERE, select: { id: true, email: true, timezone: true } });
      const scheduledAt = new Date(input.scheduledAt);
      const usersByZone = await groupByTimeZone(ctx.prisma, users, ctx.logger);

      // Immediate notice to everyone, regardless of the configured threshold ladder (which
      // only fires as the countdown crosses each one) — someone scheduling well in advance wants
      // users to know right away, not just 15/5/1 minute before. One notice per zone: the time is
      // written in each reader's zone, with the zone's short name.
      for (const [timeZone, group] of usersByZone) {
        const when = formatInstant(scheduledAt, timeZone, {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        }, DEFAULT_LOCALE);
        void bulkNotify(ctx.prisma, group.map(u => u.id), {
          category: 'SYSTEM',
          title: 'Manutenzione programmata',
          message: input.message ? `Prevista per ${when}. ${input.message}` : `Prevista per ${when}.`,
          data: { type: 'maintenance_mode_scheduled' },
        }).catch(err => ctx.logger.error({ err }, 'Maintenance mode: schedule notification failed'));
      }

      if (input.notifyByEmail) {
        const baseUrl = await getBaseUrl(ctx);
        const recipients = [...usersByZone].flatMap(([timeZone, group]) => group.map(u => ({ email: u.email, timeZone })));
        emailUsers(ctx, recipients, recipient =>
          sendMaintenanceScheduledEmail(ctx.prisma, recipient.email, scheduledAt, input.message ?? null, baseUrl, recipient.timeZone)
        );
      }

      await logAudit(ctx, {
        action: 'MAINTENANCE_MODE_SCHEDULED',
        targetType: 'MaintenanceMode',
        result: 'SUCCESS',
        metadata: {
          scheduledAt: input.scheduledAt,
          forceLogout: input.forceLogout,
          warningLeadMinutes,
        },
      });

      return state;
    }),

  /**
   * Activates maintenance mode immediately (no warning ladder — this is already a deliberate,
   * immediate action, e.g. right before a restore).
   *
   * @auth {maintenance:mode_manage}
   * @input `{ message?, forceLogout }`
   * @output The updated `MaintenanceModeState` (status `ACTIVE`).
   */
  activateNow: protectedProcedure
    .use(requirePermission('maintenance:mode_manage'))
    .input(MaintenanceModeActivateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const state = await writeMaintenanceState(ctx.prisma, {
        status: 'ACTIVE',
        scheduledAt: null,
        activatedAt: new Date().toISOString(),
        message: input.message ?? null,
        forceLogout: input.forceLogout,
        warningLeadMinutes: [],
        warningsSent: [],
        activatedByUserId: ctx.session.user.id,
        notifyByEmail: false,
      });

      if (input.forceLogout) {
        await forceLogoutNonAdmins(ctx.prisma);
      }

      await logAudit(ctx, {
        action: 'MAINTENANCE_MODE_ACTIVATED',
        targetType: 'MaintenanceMode',
        result: 'SUCCESS',
        metadata: { trigger: 'MANUAL', forceLogout: input.forceLogout },
      });

      return state;
    }),

  /**
   * Cancels a pending schedule, returning to `INACTIVE`. Only valid while `SCHEDULED`.
   *
   * @auth {maintenance:mode_manage}
   * @input None
   * @output The updated `MaintenanceModeState` (status `INACTIVE`), or `BAD_REQUEST` if nothing
   * is scheduled.
   */
  cancelScheduled: protectedProcedure.use(requirePermission('maintenance:mode_manage')).mutation(async ({ ctx }) => {
    // Checked and written under one lock (#248): a cancel can no longer switch off a maintenance
    // that the scheduler activated after the check.
    const cancelled = await transitionMaintenanceState(ctx.prisma, current =>
      current.status === 'SCHEDULED' ? DEFAULT_STATE : null
    );
    if (!cancelled) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nessuna manutenzione pianificata da annullare' });
    }

    await logAudit(ctx, {
      action: 'MAINTENANCE_MODE_CANCELLED',
      targetType: 'MaintenanceMode',
      result: 'SUCCESS',
    });

    return cancelled.next;
  }),

  /**
   * Ends active maintenance mode, returning to `INACTIVE` and unblocking non-admin traffic.
   * Only valid while `ACTIVE`. Maintenance mode never ends itself — an admin must call this
   * explicitly, after verifying the system is healthy again. Emails the "concluded" notice to
   * everyone if the admin opted into email notifications when this window was scheduled/activated.
   *
   * @auth {maintenance:mode_manage}
   * @input None
   * @output The updated `MaintenanceModeState` (status `INACTIVE`), or `BAD_REQUEST` if
   * maintenance mode isn't active.
   */
  end: protectedProcedure.use(requirePermission('maintenance:mode_manage')).mutation(async ({ ctx }) => {
    // Checked and written under one lock (#248): of two concurrent requests one ends it, the other
    // is refused, so the "concluded" email goes out once.
    const ended = await transitionMaintenanceState(ctx.prisma, current => (current.status === 'ACTIVE' ? DEFAULT_STATE : null));
    if (!ended) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La modalità manutenzione non è attiva' });
    }

    if (ended.previous.notifyByEmail) {
      const users = await ctx.prisma.user.findMany({ where: APPROVED_USER_WHERE, select: { email: true } });
      const baseUrl = await getBaseUrl(ctx);
      emailUsers(ctx, users.map(u => u.email), email => sendMaintenanceEndedEmail(ctx.prisma, email, baseUrl));
    }

    await logAudit(ctx, {
      action: 'MAINTENANCE_MODE_ENDED',
      targetType: 'MaintenanceMode',
      result: 'SUCCESS',
    });

    return ended.next;
  }),
});
