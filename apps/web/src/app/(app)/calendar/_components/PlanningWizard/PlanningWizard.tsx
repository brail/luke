'use client';

import { Info } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { narrowRouterOutput, trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';
import { FreezePlanningGroupWizard } from '../FreezePlanningGroupWizard';

import { EventStep } from './EventStep';
import { useVendorClosures } from './useVendorClosures';
import { EXPIRED_MESSAGE, SCOPE_CHANGED_MESSAGE, computeLockTargets, useWizardLock } from './useWizardLock';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

// Narrow local shape for the layout query — the full RouterOutputs inference is deep enough to
// hit TS2589 ("Type instantiation is excessively deep") when consumed inside a useMemo here.
interface WizardLayout {
  id: string;
  groups: { rows: { vendorId: string | null; planningGroupId: string }[] }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onFrozen: () => void;
  calendarId: string;
  planningGroupId: string;
  brandId: string;
  seasonId: string;
  /** Events just created by the `applyTemplate` call for `planningGroupId` — not the whole calendar. */
  events: CalendarEventItem[];
  holidayDates: HolidayMap;
}

/**
 * Linear planning wizard: walks through the events just created by one `applyTemplate` call for a
 * single planning group, one at a time, so the user can adjust the date (against holidays/vendor
 * closures) before handing off to `FreezePlanningGroupWizard` for the final freeze confirmation.
 *
 * Every event here already belongs to the same planning group, so there's no per-event row scoping
 * to configure — an event simply applies to every row of its group ("1 gruppo = 1 scope").
 *
 * Draft dates are client-only until the user advances past a step — no autosave per keystroke —
 * so back/forth navigation never leaves a half-written state.
 */
export function PlanningWizard({ open, onClose, onFrozen, calendarId, planningGroupId, brandId, seasonId, events, holidayDates }: Props) {
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'stepping' | 'freeze'>('stepping');
  const [draftDates, setDraftDates] = useState<Map<string, Date>>(
    () => new Map(sortedEvents.map(m => [m.id, new Date(m.startAt)]))
  );
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const layoutQuery = trpc.collectionLayout.get.useQuery({ brandId, seasonId }, { enabled: open });
  const layout = narrowRouterOutput<WizardLayout | null | undefined>(layoutQuery.data);
  const lockTargets = useMemo(
    () => computeLockTargets(calendarId, layout?.id, layoutQuery.status),
    [calendarId, layout?.id, layoutQuery.status]
  );
  const lock = useWizardLock(lockTargets, open);

  /**
   * Whether a lock is held *right now* — not whether one ever was. `EventStep` renders only under
   * this, which is what makes "no session was ever usable" a proof that no draft date can exist.
   */
  const isReady = lock.status === 'held';
  const heldUntil = lock.status === 'held' ? lock.expiresAt : null;

  /**
   * A held session can still be degraded: a rejected heartbeat means the lock may already be gone,
   * and a changed layout means it no longer covers what it was taken for. Either way the session
   * cannot vouch for a write, so mutation and the freeze hand-off are gated on this, not on
   * `isReady`.
   */
  const canMutate = lock.status === 'held' && lock.renewError === null && !lock.scopeChanged;

  /**
   * Three failures that used to be one `displayError`, kept apart because they differ in exactly
   * the way that matters at the exit: whether a usable session — and therefore an unsaved edit —
   * could ever have existed.
   */
  const sessionEverUsable = lock.status === 'held' || (lock.status === 'lost' && lock.wasHeld);
  const lockError = lock.status === 'lost'
    ? lock.message
    : lock.status === 'held'
      ? lock.renewError ?? (lock.scopeChanged ? SCOPE_CHANGED_MESSAGE : null)
      : null;
  /**
   * A failed `collectionLayout.get` leaves the target set unknown — `computeLockTargets` refuses to
   * guess and returns `null`, so no lock is ever attempted and no `lockError` fires for this cause.
   * Only counted *before* the session became usable: once a lock is held, the discovery query
   * failing says nothing about whether it is still held (`useWizardLock` keeps the granted set), so
   * surfacing it would turn a healthy session into an apparently broken one.
   */
  const discoveryError = layoutQuery.isError && !sessionEverUsable
    ? getTrpcErrorMessage(layoutQuery.error)
    : null;
  const displayError = lockError ?? discoveryError;

  const currentEvent = sortedEvents[stepIndex] ?? null;

  const relevantVendorIds = useMemo(() => {
    const groupRows = (layout?.groups.flatMap(g => g.rows) ?? []).filter(r => r.planningGroupId === planningGroupId);
    return [...new Set(groupRows.map(r => r.vendorId).filter((v): v is string => !!v))];
  }, [layout, planningGroupId]);
  const closedDates = useVendorClosures(relevantVendorIds, seasonId);

  const updateMilestone = trpc.seasonCalendar.updateMilestone.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  /**
   * Expiry is a lifecycle transition, so it is handled in an effect rather than in the render body.
   * Rendering it meant calling the parent's setState during this component's render (`onClose` is
   * `setPostApplyWizard(null)` in `calendar/page.tsx`) and emitting the toast once per render
   * attempt instead of once per expiry — twice under React's double-invoked render, and again on
   * every re-render until the parent got around to unmounting the wizard.
   *
   * The latch, not the dependency array, is what makes it exactly once: `onClose` is an inline
   * arrow at the call site, so its identity changes on every parent render.
   */
  const expired = lock.status === 'lost' && lock.cause === 'expired';
  const expiryHandledRef = useRef(false);
  useEffect(() => {
    if (!expired || expiryHandledRef.current) return;
    expiryHandledRef.current = true;
    toast.error(EXPIRED_MESSAGE);
    onClose();
  }, [expired, onClose]);

  if (expired) return null;

  /**
   * Only exit vector: any close attempt (overlay click, Escape, X, Annulla) opens the confirm
   * step instead — except when no session was ever usable, which is the one case where skipping it
   * is *provable* rather than merely likely: draft dates change only through `EventStep`, and
   * `EventStep` renders only under `isReady`. A discovery error arriving after readiness is not
   * that case, and used to take this exit and discard the user's edits without asking.
   */
  const requestClose = () => { if (!sessionEverUsable) { onClose(); return; } setExitConfirmOpen(true); };
  const confirmExit = () => { setExitConfirmOpen(false); onClose(); };

  const handleNext = async () => {
    // The handler enforces the full condition itself rather than trusting the button's `disabled`
    // to have been computed from the same inputs: `canMutate` is the only thing that may open an
    // `updateMilestone` or the freeze hand-off, and it is false for every degraded session.
    if (!canMutate || !currentEvent) return;

    const draft = draftDates.get(currentEvent.id);
    const dateChanged = draft && draft.getTime() !== new Date(currentEvent.startAt).getTime();
    if (dateChanged) {
      await updateMilestone.mutateAsync({ id: currentEvent.id, data: { startAt: draft.toISOString() } });
    }

    if (stepIndex < sortedEvents.length - 1) {
      setStepIndex(i => i + 1);
      return;
    }

    setPhase('freeze');
  };

  /**
   * Gated on the same condition as the step body it navigates, not merely on `isReady`: with a
   * degraded session the step is replaced by the error banner, so moving `stepIndex` under it would
   * silently change which event the user resumes on once the degradation clears. `canMutate` is
   * exactly the step's render condition — when the lock is held, `displayError` is set by precisely
   * `renewError`/`scopeChanged`, so `!displayError && isReady` and `canMutate` cannot disagree.
   */
  const handleBack = () => {
    if (!canMutate) return;
    setStepIndex(i => Math.max(0, i - 1));
  };

  if (phase === 'freeze') {
    return (
      <FreezePlanningGroupWizard
        open={open}
        onClose={() => setPhase('stepping')}
        onFrozen={onFrozen}
        planningGroupId={planningGroupId}
        milestones={sortedEvents}
      />
    );
  }

  const isLastStep = stepIndex >= sortedEvents.length - 1;

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) requestClose(); }}>
        <DialogContent
          className="sm:max-w-[720px]" // px: dialog width tuned to this wizard's content; no exact Tailwind max-w scale match
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Pianificazione guidata</DialogTitle>
          </DialogHeader>

          {displayError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {displayError}
            </p>
          )}

          {!displayError && !isReady && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Preparazione sessione di pianificazione…
            </p>
          )}

          {!displayError && isReady && currentEvent && (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                Evento {stepIndex + 1} di {sortedEvents.length}
                {heldUntil && ` — sessione valida fino alle ${heldUntil.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                {heldUntil && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      La sessione blocca calendario e collection layout per altri utenti mentre pianifichi.
                      Si rinnova automaticamente finché resti nella wizard — scade solo se la lasci aperta e inattiva a lungo.
                    </TooltipContent>
                  </Tooltip>
                )}
              </p>

              <EventStep
                event={currentEvent}
                draftDate={draftDates.get(currentEvent.id) ?? new Date(currentEvent.startAt)}
                onDraftDateChange={d => setDraftDates(prev => new Map(prev).set(currentEvent.id, d))}
                holidayDates={holidayDates}
                closedDates={closedDates}
              />
            </div>
          )}

          {!displayError && isReady && !currentEvent && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nessun evento da pianificare</p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={requestClose}>
              Annulla
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={!canMutate || stepIndex === 0}>
              Indietro
            </Button>
            <Button
              onClick={handleNext}
              disabled={!canMutate || !currentEvent || updateMilestone.isPending}
            >
              {updateMilestone.isPending
                ? 'Salvataggio…'
                : isLastStep
                  ? 'Vai al congelamento'
                  : 'Avanti'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={exitConfirmOpen}
        onOpenChange={setExitConfirmOpen}
        title="Uscire dalla pianificazione guidata?"
        description="Le modifiche non ancora salvate in questo passaggio andranno perse e la sessione di pianificazione (lock su calendario e layout) verrà rilasciata."
        confirmText="Esci"
        cancelText="Continua la pianificazione"
        actionType="warning"
        onConfirm={confirmExit}
      />
    </>
  );
}
