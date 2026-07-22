/**
 * Router tRPC per la modalità manutenzione standalone (INACTIVE -> SCHEDULED -> ACTIVE -> INACTIVE).
 *
 * `getStatus` è pubblica di proposito: deve essere leggibile anche pre-login (schermata di
 * login, banner "manutenzione in corso") — nessun dato sensibile nello stato, solo status/orario/messaggio.
 * Tutte le altre mutation sono `adminProcedure` (permesso `maintenance:update`, stesso schema
 * degli altri endpoint di dominio `maintenance`).
 */

import { TRPCError } from '@trpc/server';

import {
  MaintenanceModeActivateInputSchema,
  MaintenanceModeScheduleInputSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig } from '../lib/configManager';
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
  return (await getConfig(ctx.prisma, 'app.baseUrl', false)) || 'http://localhost:3000';
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
   */
  getStatus: publicProcedure.query(({ ctx }) => getMaintenanceState(ctx.prisma)),

  /**
   * Schedules maintenance mode to activate at a future time, with a warning ladder
   * (in-app notification + SSE push) at each `warningLeadMinutes` threshold beforehand.
   * Can be called again while already `SCHEDULED` to reschedule.
   *
   * @auth {admin}
   */
  schedule: adminProcedure
    .input(MaintenanceModeScheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Una soglia più lontana del tempo totale a disposizione non può mai scattare come
      // "preavviso" reale — es. pianificando tra 5 minuti, la soglia "15 minuti prima" cade
      // già nel passato e scatterebbe subito, in blocco con le altre. Si scartano quelle
      // irraggiungibili invece di lasciarle sparare tutte insieme al primo tick.
      // Arrotondato per eccesso: la latenza tra client e server non deve far scartare per un
      // pelo una soglia che l'admin intendeva chiaramente includere (es. "tra 5 minuti" con
      // soglia "5" non deve saltare solo perché sono passati 300ms nel frattempo).
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

      // Un'unica query utenti, riusata sia per la notifica in-app che per l'eventuale email
      // (prima erano due fetch identici su `isActive:true`, uno dentro `notifyAllUsers`, uno
      // dentro il fan-out email).
      const users = await ctx.prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true } });

      // Avviso immediato a tutti, indipendentemente dalla scala di soglie configurata (che
      // parte solo quando il countdown le attraversa) — chi pianifica con largo anticipo vuole
      // che gli utenti lo sappiano subito, non solo 15/5/1 minuto prima.
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
