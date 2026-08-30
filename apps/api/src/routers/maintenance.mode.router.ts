/**
 * tRPC router for standalone maintenance mode (INACTIVE -> SCHEDULED -> ACTIVE -> INACTIVE).
 *
 * `getStatus` is public by design: it must be readable even pre-login (login screen,
 * "maintenance in progress" banner) — no sensitive data in the state, only status/time/message.
 * All other mutations are `adminProcedure` (permission `maintenance:update`, same schema
 * as the other `maintenance` domain endpoints).
 */

import { TRPCError } from '@trpc/server';

import {
  MaintenanceModeActivateInputSchema,
  MaintenanceModeScheduleInputSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfigOrDefault } from '../lib/configManager';
import { sendBulkEmail, sendMaintenanceEndedEmail, sendMaintenanceScheduledEmail } from '../lib/mailer';
import { forceLogoutNonAdmins, getMaintenanceState, writeMaintenanceState } from '../lib/maintenanceMode';
import { bulkNotify } from '../lib/notifications';
import { adminProcedure, publicProcedure, router } from '../lib/trpc';

import type { MaintenanceModeState } from '../lib/maintenanceMode';
import type { Context } from '../lib/trpc';

/** Shared by `cancelScheduled`/`end` — both return to a clean `INACTIVE` slate, just from a different starting status. */
const INACTIVE_RESET: MaintenanceModeState = {
  status: 'INACTIVE',
  scheduledAt: null,
  activatedAt: null,
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

/** Resolves the app base URL used in email CTAs — same fallback used elsewhere for local dev. */
async function getBaseUrl(ctx: Context): Promise<string> {
  return getConfigOrDefault(ctx.prisma, 'app.baseUrl');
}

/**
 * Fire-and-forget fan-out of `send` to `emails` (via `sendBulkEmail`) — the admin's mutation
 * response shouldn't block on however long SMTP takes for a potentially large user base.
 * Failures are logged in aggregate, never thrown.
 */
function emailUsers(ctx: Context, emails: string[], send: (email: string) => Promise<void>): void {
  void sendBulkEmail(emails, send)
    .then(({ failed }) => {
      if (failed > 0) ctx.logger.error({ failed, total: emails.length }, 'Maintenance mode: invio email fallito per alcuni utenti');
    })
    .catch(err => ctx.logger.error({ err }, 'Maintenance mode: invio email fallito'));
}

export const maintenanceModeRouter = router({
  /**
   * Returns the current maintenance-mode state. Public — no session required.
   *
   * @auth public
   * @input None
   * @output `MaintenanceModeState` — `{ status, scheduledAt, activatedAt, message, forceLogout,
   * warningLeadMinutes, warningsSent, activatedByUserId, notifyByEmail }`.
   */
  getStatus: publicProcedure.query(({ ctx }) => getMaintenanceState(ctx.prisma)),

  /**
   * Schedules maintenance mode to activate at a future time, with a warning ladder
   * (in-app notification + SSE push) at each `warningLeadMinutes` threshold beforehand.
   * Can be called again while already `SCHEDULED` to reschedule.
   *
   * @auth {admin}
   * @input `{ scheduledAt, message?, forceLogout, warningLeadMinutes, notifyByEmail }`
   * @output The updated `MaintenanceModeState` (status `SCHEDULED`).
   */
  schedule: adminProcedure
    .input(MaintenanceModeScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      // A threshold farther out than the total time available can never fire as a real
      // "advance warning" — e.g. scheduling for 5 minutes from now, the "15 minutes before"
      // threshold is already in the past and would fire immediately, lumped in with the others.
      // Unreachable ones are discarded instead of letting them all fire together on the first tick.
      // Rounded up: latency between client and server shouldn't cause a threshold the admin
      // clearly intended to include to be dropped by a hair (e.g. "in 5 minutes" with
      // threshold "5" shouldn't be skipped just because 300ms have passed in the meantime).
      const totalLeadMinutes = Math.ceil((new Date(input.scheduledAt).getTime() - Date.now()) / 60_000);
      const warningLeadMinutes = input.warningLeadMinutes.filter(t => t <= totalLeadMinutes);

      const state = await writeMaintenanceState(ctx.prisma, {
        status: 'SCHEDULED',
        scheduledAt: input.scheduledAt,
        activatedAt: null,
        message: input.message ?? null,
        forceLogout: input.forceLogout,
        warningLeadMinutes,
        warningsSent: [],
        activatedByUserId: ctx.session.user.id,
        notifyByEmail: input.notifyByEmail,
      });

      // A single user query, reused for both the in-app notification and the optional email
      // (previously there were two identical fetches on `isActive:true`, one inside `notifyAllUsers`, one
      // inside the email fan-out).
      const users = await ctx.prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true } });

      // Immediate notice to everyone, regardless of the configured threshold ladder (which
      // only fires as the countdown crosses each one) — someone scheduling well in advance wants
      // users to know right away, not just 15/5/1 minute before.
      void bulkNotify(ctx.prisma, users.map(u => u.id), {
        category: 'SYSTEM',
        title: 'Manutenzione programmata',
        message: input.message
          ? `Prevista per ${new Date(input.scheduledAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}. ${input.message}`
          : `Prevista per ${new Date(input.scheduledAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}.`,
        data: { type: 'maintenance_mode_scheduled' },
      }).catch(err => ctx.logger.error({ err }, 'Maintenance mode: notifica pianificazione fallita'));

      if (input.notifyByEmail) {
        const baseUrl = await getBaseUrl(ctx);
        emailUsers(ctx, users.map(u => u.email), email =>
          sendMaintenanceScheduledEmail(ctx.prisma, email, new Date(input.scheduledAt), input.message ?? null, baseUrl)
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
   * @auth {admin}
   * @input `{ message?, forceLogout }`
   * @output The updated `MaintenanceModeState` (status `ACTIVE`).
   */
  activateNow: adminProcedure
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
   * @auth {admin}
   * @input None
   * @output The updated `MaintenanceModeState` (status `INACTIVE`), or `BAD_REQUEST` if nothing
   * is scheduled.
   */
  cancelScheduled: adminProcedure.mutation(async ({ ctx }) => {
    const current = await getMaintenanceState(ctx.prisma);
    if (current.status !== 'SCHEDULED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nessuna manutenzione pianificata da annullare' });
    }

    const state = await writeMaintenanceState(ctx.prisma, INACTIVE_RESET);

    await logAudit(ctx, {
      action: 'MAINTENANCE_MODE_CANCELLED',
      targetType: 'MaintenanceMode',
      result: 'SUCCESS',
    });

    return state;
  }),

  /**
   * Ends active maintenance mode, returning to `INACTIVE` and unblocking non-admin traffic.
   * Only valid while `ACTIVE`. Maintenance mode never ends itself — an admin must call this
   * explicitly, after verifying the system is healthy again. Emails the "concluded" notice to
   * everyone if the admin opted into email notifications when this window was scheduled/activated.
   *
   * @auth {admin}
   * @input None
   * @output The updated `MaintenanceModeState` (status `INACTIVE`), or `BAD_REQUEST` if
   * maintenance mode isn't active.
   */
  end: adminProcedure.mutation(async ({ ctx }) => {
    const current = await getMaintenanceState(ctx.prisma);
    if (current.status !== 'ACTIVE') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La modalità manutenzione non è attiva' });
    }

    const state = await writeMaintenanceState(ctx.prisma, INACTIVE_RESET);

    if (current.notifyByEmail) {
      const users = await ctx.prisma.user.findMany({ where: { isActive: true }, select: { email: true } });
      const baseUrl = await getBaseUrl(ctx);
      emailUsers(ctx, users.map(u => u.email), email => sendMaintenanceEndedEmail(ctx.prisma, email, baseUrl));
    }

    await logAudit(ctx, {
      action: 'MAINTENANCE_MODE_ENDED',
      targetType: 'MaintenanceMode',
      result: 'SUCCESS',
    });

    return state;
  }),
});
