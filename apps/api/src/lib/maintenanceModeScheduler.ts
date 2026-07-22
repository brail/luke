/**
 * Maintenance-mode warning ladder + auto-activation.
 *
 * Self-rescheduling tick (`setTimeout` chain, not a fixed `setInterval`): the delay until the
 * next tick is recomputed after every run, from the current urgency tier
 * (`getMaintenanceUrgencyTier`, shared with the frontend banner). Far out (days away) it barely
 * ticks at all; as the countdown enters its last 15 minutes it tightens to 10s, since at that
 * point the tick's own timing IS the user-visible precision of both the warning countdown and
 * the actual lockout moment — any coarser and there's visible drift between what the client's
 * live countdown shows and when things actually happen.
 *
 * While `SCHEDULED`: for each `warningLeadMinutes` threshold not yet in `warningsSent`, once
 * the countdown crosses it, broadcasts an in-app notification (all users) —
 * `writeMaintenanceState` itself already pushes the SSE state update, so clients with the
 * banner open update live regardless of the notification. Once the countdown reaches zero,
 * transitions to `ACTIVE` and force-logs-out non-admins if configured. `ACTIVE` never ends
 * on its own — an admin must call `maintenance.mode.end` explicitly.
 */

import { getMaintenanceUrgencyTier } from '@luke/core';

import { forceLogoutNonAdmins, getMaintenanceState, markActivated, recordWarningsSent } from './maintenanceMode';
import { notifyAllUsers } from './notifications';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

/** Tick delay while `INACTIVE`/`ACTIVE` — nothing time-sensitive to track, just a heartbeat. */
const IDLE_DELAY_MS = 5 * 60 * 1000;

const TIER_DELAY_MS = {
  far: 10 * 60 * 1000,
  normal: 60 * 1000,
  approaching: 30 * 1000,
  imminent: 10 * 1000,
} as const;

/** Runs one tick and returns the delay to wait before the next one. */
async function runTick(prisma: PrismaClient, log: FastifyInstance['log']): Promise<number> {
  const state = await getMaintenanceState(prisma);
  if (state.status !== 'SCHEDULED' || !state.scheduledAt) return IDLE_DELAY_MS;

  const minutesRemaining = (new Date(state.scheduledAt).getTime() - Date.now()) / 60_000;

  if (minutesRemaining <= 0) {
    log.info('Maintenance mode scheduler: countdown esaurito, attivazione automatica');
    await markActivated(prisma, state);
    if (state.forceLogout) await forceLogoutNonAdmins(prisma);
    return IDLE_DELAY_MS;
  }

  const crossed = state.warningLeadMinutes.filter(
    threshold => minutesRemaining <= threshold && !state.warningsSent.includes(threshold)
  );
  if (crossed.length > 0) {
    // Più soglie possono attraversarsi nello stesso tick (es. dopo un downtime dello scheduler) —
    // un'unica notifica con quella più urgente (la più vicina), non una raffica che rifarebbe la
    // stessa query utenti + broadcast SSE una volta per soglia per lo stesso evento concettuale.
    const mostUrgent = Math.min(...crossed);
    await notifyAllUsers(prisma, {
      category: 'SYSTEM',
      title: 'Manutenzione programmata in arrivo',
      message: state.message
        ? `${state.message} (tra circa ${mostUrgent} minut${mostUrgent === 1 ? 'o' : 'i'})`
        : `Il sistema entrerà in manutenzione tra circa ${mostUrgent} minut${mostUrgent === 1 ? 'o' : 'i'}. Salva il lavoro in corso.`,
      data: { type: 'maintenance_mode_warning', minutesRemaining: mostUrgent },
    }).catch(err => log.error({ err, crossed }, 'Maintenance mode scheduler: notifica soglia fallita'));

    await recordWarningsSent(prisma, state, crossed);
  }

  return TIER_DELAY_MS[getMaintenanceUrgencyTier(minutesRemaining)];
}

/**
 * Registers the maintenance-mode scheduler as a Fastify plugin (`onReady`/`onClose`).
 * Unlike the other tick-based schedulers (fixed-interval), this one self-reschedules with a
 * dynamic delay — see module docstring.
 */
export function registerMaintenanceModeScheduler(fastify: FastifyInstance, prisma: PrismaClient): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const tick = async () => {
    let delay = IDLE_DELAY_MS;
    try {
      delay = await runTick(prisma, fastify.log);
    } catch (err) {
      fastify.log.error({ err }, 'Maintenance mode scheduler: errore non gestito');
    }
    if (!stopped) timer = setTimeout(() => void tick(), delay);
  };

  fastify.addHook('onReady', async () => {
    fastify.log.info('Maintenance mode scheduler: avviato (tick dinamico, 10s-10min in base al countdown)');
    void tick();
  });

  fastify.addHook('onClose', async () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    fastify.log.info('Maintenance mode scheduler: fermato');
  });
}
