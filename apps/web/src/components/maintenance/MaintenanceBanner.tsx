'use client';

import { AlertTriangle, Info, Wrench } from 'lucide-react';
import { toast } from 'sonner';

import { getMaintenanceUrgencyTier, type MaintenanceModeState, type MaintenanceUrgencyTier } from '@luke/core';

import { trpc } from '../../lib/trpc';
import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { Button } from '../ui/button';

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Far/normal tiers show the actual date/time (a precise mm:ss countdown is noise a day out); approaching/imminent switch to the live countdown, where second-level precision actually matters. */
function formatRemaining(tier: MaintenanceUrgencyTier, msRemaining: number, scheduledAt: string): string {
  if (tier === 'far' || tier === 'normal') {
    return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt));
  }
  return `tra ${formatCountdown(msRemaining)}`;
}

const TIER_STYLE: Record<MaintenanceUrgencyTier, string> = {
  far: 'bg-slate-100 text-slate-600 text-xs py-1',
  normal: 'bg-slate-200 text-slate-700 text-sm py-1.5',
  approaching: 'bg-amber-200 text-amber-900 text-sm py-2 font-medium',
  imminent: 'bg-amber-500 text-amber-950 text-sm py-2 font-medium',
};

const TIER_ICON: Record<MaintenanceUrgencyTier, typeof Info> = {
  far: Info,
  normal: Info,
  approaching: AlertTriangle,
  imminent: AlertTriangle,
};

interface MaintenanceBannerProps {
  state: MaintenanceModeState;
  isAdmin: boolean;
  msRemaining: number | null;
}

/**
 * Persistent top bar shown whenever maintenance mode is `SCHEDULED` (countdown, all users) or
 * `ACTIVE` while the viewer is an admin (discrete notice + one-click "end maintenance" — admins
 * are never locked out, see `MaintenanceLockScreen` for the non-admin `ACTIVE` case).
 *
 * `SCHEDULED` visually escalates through 4 tiers as the countdown shrinks (`getMaintenanceUrgencyTier`,
 * shared with the scheduler's own tick cadence) — a maintenance window scheduled days out shouldn't
 * look as alarming as one about to start.
 */
export function MaintenanceBanner({ state, isAdmin, msRemaining }: MaintenanceBannerProps) {
  const utils = trpc.useUtils();
  const endMutation = trpc.maintenance.mode.end.useMutation({
    onSuccess: () => {
      toast.success('Modalità manutenzione terminata');
      void utils.maintenance.mode.getStatus.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (state.status === 'SCHEDULED' && state.scheduledAt && msRemaining !== null) {
    const tier = getMaintenanceUrgencyTier(msRemaining / 60_000);
    const Icon = TIER_ICON[tier];
    return (
      <div className={`flex items-center justify-center gap-2 px-4 ${TIER_STYLE[tier]}`}>
        <Icon className="h-4 w-4 shrink-0" />
        <span>
          {state.message || 'Manutenzione programmata'} — {formatRemaining(tier, msRemaining, state.scheduledAt)}
        </span>
      </div>
    );
  }

  if (state.status === 'ACTIVE' && isAdmin) {
    return (
      <div className="flex items-center justify-center gap-3 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100">
        <Wrench className="h-4 w-4 shrink-0" />
        <span>Modalità manutenzione attiva (visibile solo a te come admin)</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => endMutation.mutate()}
          disabled={endMutation.isPending}
        >
          {endMutation.isPending ? 'Termino...' : 'Termina manutenzione'}
        </Button>
      </div>
    );
  }

  return null;
}
