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
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';
import { EventAnchorDialog } from '../EventAnchorDialog';
import { FreezeCalendarWizard } from '../FreezeCalendarWizard';

import { EventStep } from './EventStep';
import { useVendorClosures } from './useVendorClosures';
import { useWizardLock } from './useWizardLock';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

interface Props {
  open: boolean;
  onClose: () => void;
  onFrozen: () => void;
  calendarId: string;
  brandId: string;
  seasonId: string;
  milestones: CalendarEventItem[];
  holidayDates: HolidayMap;
  onAnchorsChanged: () => void;
}

/** A branch of the row-fork tree waiting to be walked, once the currently active branch ends. */
interface PendingBranch {
  /** Position (in the original event sequence) this branch resumes from — for step numbering. */
  forkGlobalIndex: number;
  /** Rows this branch is responsible for. */
  rowIds: string[];
  /** Ids of the events to duplicate (snapshotted at fork time) when this branch is picked up. */
  sourceEventIds: string[];
}

/**
 * Multi-step planning wizard: walks through the calendar's events one at a time so the user can
 * adjust the date (against holidays/vendor closures) and the row scope (fork), before handing off
 * to the existing `FreezeCalendarWizard` for the final confirmation.
 *
 * Draft dates are client-only until the user advances past a step — no autosave per keystroke —
 * so back/forth navigation never leaves a half-written state.
 *
 * Row fork: scoping an event to a proper subset of the active branch's rows splits the plan in
 * two — the branch continues (narrowed to that subset, reusing the same events) while the
 * complement is pushed onto `pendingBranches`. When a branch reaches its last event, the next
 * pending branch (if any) is popped, its events duplicated and anchored to its rows, and stepping
 * resumes from its fork point. Freezing is only reachable once every row has reached the end of
 * some branch — i.e. `pendingBranches` is empty. A resumed branch can itself fork again (nested
 * push), so this handles arbitrarily many splits, not just two.
 */
export function PlanningWizard({ open, onClose, onFrozen, calendarId, brandId, seasonId, milestones, holidayDates, onAnchorsChanged }: Props) {
  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [milestones]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<'stepping' | 'freeze'>('stepping');
  const [draftDates, setDraftDates] = useState<Map<string, Date>>(
    () => new Map(sortedMilestones.map(m => [m.id, new Date(m.startAt)]))
  );
  const [anchorEventId, setAnchorEventId] = useState<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  // Fork state — see PendingBranch doc above. `activeRowIds === null` means "no fork yet, applies
  // to every row" (the common, linear case).
  const [activeEvents, setActiveEvents] = useState<CalendarEventItem[]>(() => sortedMilestones);
  const [activeRowIds, setActiveRowIds] = useState<string[] | null>(null);
  const [activeForkGlobalIndex, setActiveForkGlobalIndex] = useState(0);
  const [pendingBranches, setPendingBranches] = useState<PendingBranch[]>([]);
  /** Events already explicitly or auto-scoped this session — avoids re-deriving from possibly
   * stale `.anchors` on locally-held (duplicated) events, and avoids redundant writes. */
  const [scopedEventIds, setScopedEventIds] = useState<Set<string>>(new Set());

  const { data: layout } = trpc.collectionLayout.get.useQuery({ brandId, seasonId }, { enabled: open });
  const lockTargets = useMemo(() => {
    const targets: { entityType: 'SEASON_CALENDAR' | 'COLLECTION_LAYOUT'; entityId: string }[] = [
      { entityType: 'SEASON_CALENDAR', entityId: calendarId },
    ];
    if (layout?.id) targets.push({ entityType: 'COLLECTION_LAYOUT', entityId: layout.id });
    return targets;
  }, [calendarId, layout?.id]);
  const lock = useWizardLock(lockTargets, open);

  const currentEvent = activeEvents[stepIndex] ?? null;
  const anchorEvent = activeEvents.find(m => m.id === anchorEventId) ?? null;

  const rows = layout?.groups.flatMap(g => g.rows) ?? [];
  const allRowIds = useMemo(() => rows.map(r => r.id), [rows]);
  const currentActiveRowIds = activeRowIds ?? allRowIds;

  const relevantVendorIds = useMemo(() => {
    if (!currentEvent) return [];
    const rowAnchors = (currentEvent.anchors ?? []).filter(a => a.entityType === 'COLLECTION_LAYOUT_ROW');
    const relevantRows = rowAnchors.length === 0
      ? rows
      : rows.filter(r => rowAnchors.some(a => a.entityId === r.id));
    return [...new Set(relevantRows.map(r => r.vendorId).filter((v): v is string => !!v))];
  }, [currentEvent, rows]);
  const closedDates = useVendorClosures(relevantVendorIds, seasonId);

  const updateMilestone = trpc.seasonCalendar.updateMilestone.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const setEventAnchors = trpc.seasonCalendar.setEventAnchors.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const duplicateEventsFrom = trpc.seasonCalendar.duplicateEventsFrom.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (lock.expired) {
    toast.error('Sessione di pianificazione scaduta — ricomincia');
    onClose();
    return null;
  }

  /** Resets step/phase back to the start — shared by cancel-exit and post-freeze completion. */
  const resetStepping = () => {
    setStepIndex(0);
    setPhase('stepping');
  };

  const handleClose = () => {
    resetStepping();
    onClose();
  };

  /** Only exit vector: any close attempt (overlay click, Escape, X, Annulla) opens the confirm step instead. */
  const requestClose = () => setExitConfirmOpen(true);
  const confirmExit = () => { setExitConfirmOpen(false); handleClose(); };

  const handleAnchorSaved = (anchors: { entityType: string; entityId: string }[]) => {
    const savedEventId = anchorEventId;
    setAnchorEventId(null);
    onAnchorsChanged();
    if (!savedEventId) return;
    setScopedEventIds(prev => new Set(prev).add(savedEventId));

    const subsetRowIds = anchors.filter(a => a.entityType === 'COLLECTION_LAYOUT_ROW').map(a => a.entityId);
    // Empty selection means "all rows of this branch" — not a fork. A full reselect of every
    // currently-active row is equivalent to "all" too — also not a fork.
    if (subsetRowIds.length === 0 || subsetRowIds.length >= currentActiveRowIds.length) return;

    const complementRowIds = currentActiveRowIds.filter(id => !subsetRowIds.includes(id));
    if (complementRowIds.length === 0) return;

    const forkStepIndex = activeEvents.findIndex(e => e.id === savedEventId);
    if (forkStepIndex === -1) return;

    setPendingBranches(prev => [...prev, {
      forkGlobalIndex: activeForkGlobalIndex + forkStepIndex,
      rowIds: complementRowIds,
      sourceEventIds: activeEvents.slice(forkStepIndex).map(e => e.id),
    }]);
    setActiveRowIds(subsetRowIds);
  };

  const handleNext = async () => {
    if (!currentEvent) return;

    // Date commit and scope auto-narrow are independent writes — run them together.
    const draft = draftDates.get(currentEvent.id);
    const dateChanged = draft && draft.getTime() !== new Date(currentEvent.startAt).getTime();
    // Auto-narrow: once a fork is active, every event of this branch must stay scoped to it —
    // apply silently unless the user already scoped this specific event explicitly.
    const needsAutoNarrow = activeRowIds !== null && !scopedEventIds.has(currentEvent.id);

    await Promise.all([
      dateChanged
        ? updateMilestone.mutateAsync({ id: currentEvent.id, data: { startAt: draft.toISOString() } })
        : null,
      needsAutoNarrow
        ? setEventAnchors.mutateAsync({
            eventId: currentEvent.id,
            anchors: activeRowIds!.map(rowId => ({ entityType: 'COLLECTION_LAYOUT_ROW' as const, entityId: rowId })),
          })
        : null,
    ]);
    if (needsAutoNarrow) setScopedEventIds(prev => new Set(prev).add(currentEvent.id));

    if (stepIndex < activeEvents.length - 1) {
      setStepIndex(i => i + 1);
      return;
    }

    if (pendingBranches.length > 0) {
      const next = pendingBranches[pendingBranches.length - 1]!;
      const remaining = pendingBranches.length - 1;
      setPendingBranches(prev => prev.slice(0, -1));

      const duplicates = await duplicateEventsFrom.mutateAsync({
        eventIds: next.sourceEventIds,
        rowIds: next.rowIds,
      });

      setActiveEvents(duplicates);
      setActiveRowIds(next.rowIds);
      setActiveForkGlobalIndex(next.forkGlobalIndex);
      setScopedEventIds(prev => new Set([...prev, ...duplicates.map(d => d.id)]));
      setDraftDates(prev => {
        const merged = new Map(prev);
        duplicates.forEach(d => merged.set(d.id, new Date(d.startAt)));
        return merged;
      });
      setStepIndex(0);
      toast.info(
        `Ramo per ${next.rowIds.length} riga${next.rowIds.length === 1 ? '' : 'e'} rimanenti` +
        (remaining > 0 ? ` — ${remaining} ${remaining === 1 ? 'ramo' : 'rami'} ancora in coda` : '')
      );
      return;
    }

    setPhase('freeze');
  };

  const handleBack = () => setStepIndex(i => Math.max(0, i - 1));

  if (phase === 'freeze') {
    return (
      <FreezeCalendarWizard
        open={open}
        onClose={() => setPhase('stepping')}
        onFrozen={() => { resetStepping(); onFrozen(); }}
        calendarId={calendarId}
        milestones={activeEvents}
        holidayDates={holidayDates}
      />
    );
  }

  const isLastStepOfLastBranch = stepIndex >= activeEvents.length - 1 && pendingBranches.length === 0;

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
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {lock.error}
            </p>
          )}

          {!lock.error && currentEvent && (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">
                Evento {activeForkGlobalIndex + stepIndex + 1} di {sortedMilestones.length}
                {lock.expiresAt && ` — sessione valida fino alle ${lock.expiresAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
              </p>

              {(activeRowIds !== null || pendingBranches.length > 0) && (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 space-y-0.5">
                  {activeRowIds !== null && (
                    <p>Ramo corrente: {activeRowIds.length} riga{activeRowIds.length === 1 ? '' : 'e'} di competenza.</p>
                  )}
                  {pendingBranches.length > 0 && (
                    <p>{pendingBranches.length} ramo{pendingBranches.length === 1 ? '' : 'i'} ancora in coda — il congelamento resta bloccato finché non sono completati.</p>
                  )}
                </div>
              )}

              <EventStep
                event={currentEvent}
                draftDate={draftDates.get(currentEvent.id) ?? new Date(currentEvent.startAt)}
                onDraftDateChange={d => setDraftDates(prev => new Map(prev).set(currentEvent.id, d))}
                holidayDates={holidayDates}
                closedDates={closedDates}
                onOpenAnchor={() => setAnchorEventId(currentEvent.id)}
              />
            </div>
          )}

          {!lock.error && !currentEvent && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nessun evento nel calendario</p>
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
              disabled={!currentEvent || updateMilestone.isPending || setEventAnchors.isPending || duplicateEventsFrom.isPending || !!lock.error}
            >
              {updateMilestone.isPending || setEventAnchors.isPending || duplicateEventsFrom.isPending
                ? 'Salvataggio…'
                : isLastStepOfLastBranch
                  ? 'Vai al congelamento'
                  : 'Avanti'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {anchorEvent && (
        <EventAnchorDialog
          key={anchorEvent.id}
          open={!!anchorEventId}
          onClose={() => setAnchorEventId(null)}
          onSaved={handleAnchorSaved}
          eventId={anchorEvent.id}
          eventTitle={anchorEvent.title}
          brandId={brandId}
          seasonId={seasonId}
          currentAnchors={anchorEvent.anchors ?? []}
          availableRowIds={activeRowIds ?? undefined}
        />
      )}

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
