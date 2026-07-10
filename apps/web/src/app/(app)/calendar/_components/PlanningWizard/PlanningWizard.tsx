'use client';

import { useMemo, useState } from 'react';
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
import { narrowRouterOutput, trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';
import { FreezePlanningGroupWizard } from '../FreezePlanningGroupWizard';

import { EventStep } from './EventStep';
import { useVendorClosures } from './useVendorClosures';
import { useWizardLock } from './useWizardLock';

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

  const { data: rawLayout } = trpc.collectionLayout.get.useQuery({ brandId, seasonId }, { enabled: open });
  const layout = narrowRouterOutput<WizardLayout | null | undefined>(rawLayout);
  const lockTargets = useMemo(() => {
    const targets: { entityType: 'SEASON_CALENDAR' | 'COLLECTION_LAYOUT'; entityId: string }[] = [
      { entityType: 'SEASON_CALENDAR', entityId: calendarId },
    ];
    if (layout?.id) targets.push({ entityType: 'COLLECTION_LAYOUT', entityId: layout.id });
    return targets;
  }, [calendarId, layout?.id]);
  const lock = useWizardLock(lockTargets, open);

  const currentEvent = sortedEvents[stepIndex] ?? null;

  const relevantVendorIds = useMemo(() => {
    const groupRows = (layout?.groups.flatMap(g => g.rows) ?? []).filter(r => r.planningGroupId === planningGroupId);
    return [...new Set(groupRows.map(r => r.vendorId).filter((v): v is string => !!v))];
  }, [layout, planningGroupId]);
  const closedDates = useVendorClosures(relevantVendorIds, seasonId);

  const updateMilestone = trpc.seasonCalendar.updateMilestone.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (lock.expired) {
    toast.error('Sessione di pianificazione scaduta — ricomincia');
    onClose();
    return null;
  }

  /** Only exit vector: any close attempt (overlay click, Escape, X, Annulla) opens the confirm step instead. */
  const requestClose = () => setExitConfirmOpen(true);
  const confirmExit = () => { setExitConfirmOpen(false); onClose(); };

  const handleNext = async () => {
    if (!currentEvent) return;

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

  const handleBack = () => setStepIndex(i => Math.max(0, i - 1));

  if (phase === 'freeze') {
    return (
      <FreezePlanningGroupWizard
        open={open}
        onClose={() => setPhase('stepping')}
        onFrozen={onFrozen}
        planningGroupId={planningGroupId}
        milestones={sortedEvents}
        holidayDates={holidayDates}
      />
    );
  }

  const isLastStep = stepIndex >= sortedEvents.length - 1;

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) requestClose(); }}>
        <DialogContent
          className="sm:max-w-[720px]"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Pianificazione guidata</DialogTitle>
          </DialogHeader>

          {lock.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {lock.error}
            </p>
          )}

          {!lock.error && currentEvent && (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">
                Evento {stepIndex + 1} di {sortedEvents.length}
                {lock.expiresAt && ` — sessione valida fino alle ${lock.expiresAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
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

          {!lock.error && !currentEvent && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nessun evento da pianificare</p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={requestClose}>
              Annulla
            </Button>
            <Button variant="outline" onClick={handleBack} disabled={stepIndex === 0}>
              Indietro
            </Button>
            <Button
              onClick={handleNext}
              disabled={!currentEvent || updateMilestone.isPending || !!lock.error}
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
        variant="destructive"
        actionType="warning"
        onConfirm={confirmExit}
      />
    </>
  );
}
