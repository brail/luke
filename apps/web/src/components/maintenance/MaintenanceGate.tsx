'use client';

import { useEffect, useRef, useState } from 'react';

import { getMaintenanceUrgencyTier } from '@luke/core';

import { useMaintenanceStatus } from '../../hooks/use-maintenance-status';
import { usePermission } from '../../hooks/usePermission';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

import { MaintenanceBanner } from './MaintenanceBanner';
import { MaintenanceLockScreen } from './MaintenanceLockScreen';

/**
 * Global maintenance-mode UI, mounted once at the root provider tree (before `{children}`,
 * so the banner renders above the entire app including the sidebar layout).
 *
 * - `SCHEDULED`: persistent top banner with a live countdown, plus a blocking "Ho capito"
 *   alert dialog re-shown at each `warningLeadMinutes` threshold the backend confirms crossed.
 * - `ACTIVE`, non-admin (including logged-out visitors — the login page itself is covered):
 *   full-screen lock via `MaintenanceLockScreen`.
 * - `ACTIVE`, admin: discrete top banner only, never locked out.
 */
export function MaintenanceGate() {
  const { state } = useMaintenanceStatus();
  const { getUserRole } = usePermission();
  const isAdmin = getUserRole() === 'admin';

  const isScheduled = state?.status === 'SCHEDULED';

  const [now, setNow] = useState(() => Date.now());
  const msRemaining = isScheduled && state?.scheduledAt ? new Date(state.scheduledAt).getTime() - now : null;
  // Only the last 15 minutes need second-level precision (the countdown display switches to
  // mm:ss there too, see MaintenanceBanner) — ticking every second for a window scheduled days
  // out would just re-render this globally-mounted component for no visible change.
  const tier = msRemaining !== null ? getMaintenanceUrgencyTier(msRemaining / 60_000) : null;
  const needsPreciseTick = tier === 'approaching' || tier === 'imminent';
  useEffect(() => {
    if (!isScheduled) return;
    const id = setInterval(() => setNow(Date.now()), needsPreciseTick ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [isScheduled, needsPreciseTick]);

  // Largest not-yet-acknowledged threshold this browser tab has seen. Thresholds are always
  // dismissed largest-first (only the current max is ever shown), so a single "ceiling" below
  // which everything counts as acknowledged is equivalent to tracking a whole set of them.
  // Reset whenever a new schedule starts (new `scheduledAt`), so a reschedule re-warns from scratch.
  const [ackCeiling, setAckCeiling] = useState(Infinity);
  const lastScheduledAtRef = useRef<string | null>(null);
  useEffect(() => {
    const scheduledAt = state?.scheduledAt ?? null;
    if (scheduledAt !== lastScheduledAtRef.current) {
      lastScheduledAtRef.current = scheduledAt;
      setAckCeiling(Infinity);
    }
  }, [state?.scheduledAt]);

  // Driven by the backend's `warningsSent` (not a client-side recomputation of the threshold
  // crossing) so the modal stays in lockstep with what the server has actually confirmed.
  const activeThreshold = isScheduled
    ? [...(state?.warningsSent ?? [])].filter(t => t < ackCeiling).sort((a, b) => b - a)[0] ?? null
    : null;

  if (!state) return null;

  return (
    <>
      {state.status !== 'INACTIVE' && (
        <MaintenanceBanner state={state} isAdmin={isAdmin} msRemaining={msRemaining} />
      )}
      {state.status === 'ACTIVE' && !isAdmin && <MaintenanceLockScreen message={state.message} />}

      <AlertDialog open={activeThreshold !== null} onOpenChange={() => { /* dismiss only via "Ho capito" below */ }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Manutenzione tra circa {activeThreshold} minut{activeThreshold === 1 ? 'o' : 'i'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {state.message || 'Il sistema andrà in manutenzione a breve.'} Salva il lavoro in corso prima di allora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                if (activeThreshold === null) return;
                setAckCeiling(activeThreshold);
              }}
            >
              Ho capito
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
