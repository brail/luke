'use client';

import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { formatCalendarDate } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { eventDays } from '../utils';

import type { CalendarEventItem } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onFrozen: () => void;
  planningGroupId: string;
  /** The reader zone: each event's first date is read in it. */
  zone: string;
  milestones: CalendarEventItem[];
}

/** Human label for why `resolveHolidayOverlapsForGroup` flagged an event — mirrors the `reason`
 * union returned by the `seasonCalendar.holidayOverlapsForGroup` query. */
function overlapReasonLabel(entry: { reason: 'weekend' | 'company' | 'vendor'; vendorName?: string }): string {
  if (entry.reason === 'weekend') return 'weekend';
  if (entry.reason === 'company') return 'festività azienda';
  return `chiusura fornitore${entry.vendorName ? ` «${entry.vendorName}»` : ''}`;
}

/**
 * Confirms freezing a planning group's baseline: snapshots every one of its events' current
 * startAt/endAt into baselineStartAt/baselineEndAt (immutable, written once). startAt/endAt remain
 * freely editable afterwards — only this baseline snapshot is locked, for measuring plan-vs-actual
 * drift. Events added to the group after freeze simply never get a baseline (freeze is never
 * retroactively re-applied) — use "estendi freeze" (amendPlanningGroupFreeze) afterwards.
 *
 * A group plans only the phases it needs (#159), so nothing blocks the freeze. One soft warning:
 * events whose deadline countdown depends on a calendar (`calendarDaysRelevance`
 * COMPANY/VENDOR/BOTH) landing on a non-working day (`holidayOverlapsForGroup`) — informational
 * only, the user can freeze anyway.
 *
 * @param milestones - The planning group's events, used for the summary list.
 * @param onFrozen - Called after the group is successfully frozen.
 */
export function FreezePlanningGroupWizard({ open, onClose, onFrozen, planningGroupId, zone, milestones }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: holidayOverlaps } = trpc.seasonCalendar.holidayOverlapsForGroup.useQuery(
    { planningGroupId }, { enabled: open }
  );

  const overlapsByEvent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const entry of holidayOverlaps ?? []) {
      const label = overlapReasonLabel(entry);
      if (!map.has(entry.eventId)) map.set(entry.eventId, new Set());
      map.get(entry.eventId)!.add(label);
    }
    return map;
  }, [holidayOverlaps]);

  const freezeMutation = trpc.seasonCalendar.freezePlanningGroup.useMutation({
    onSuccess: () => {
      toast.success('Gruppo di pianificazione congelato — baseline salvata');
      // frozenAt drives seasonState/showFreezeInBar and the freeze/unfreeze picker filter in every
      // caller (manual picker, template-apply auto-freeze) — invalidate here once, not per-caller.
      void utils.planningGroup.list.invalidate();
      onFrozen();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err, { CONFLICT: 'Gruppo già congelato' })),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent
          className="sm:max-w-[600px]" // px: dialog width tuned to this wizard's content; no exact Tailwind max-w scale match
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Congela pianificazione</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Salva uno snapshot immutabile delle date correnti di tutti gli eventi ({milestones.length}) del
              gruppo di pianificazione come baseline &quot;in teoria&quot;. Le date degli eventi restano modificabili dopo
              il congelamento — solo lo snapshot resta fisso, per misurare in futuro lo scostamento tra piano e realtà.
            </p>

            {overlapsByEvent.size > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{overlapsByEvent.size} eventi cadono su un giorno non lavorativo</p>
                  <p className="text-xs mt-0.5">Solo per eventi il cui conteggio giorni scadenza usa un calendario (azienda/fornitore). Verifica le date, se necessario — non blocca il congelamento.</p>
                </div>
              </div>
            )}

            <ScrollArea className="h-56 rounded-md border">
              <div className="p-2 space-y-1">
                {milestones.map(m => {
                  const overlapReasons = overlapsByEvent.get(m.id);
                  return (
                    <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm">
                      <span className="flex-1 truncate">{m.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatCalendarDate(eventDays(m, zone)[0], {})}
                      </span>
                      {overlapReasons && (
                        <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                          {[...overlapReasons].join(', ')}
                        </Badge>
                      )}
                    </div>
                  );
                })}
                {milestones.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">Nessun evento nel gruppo</p>
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={freezeMutation.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={freezeMutation.isPending || milestones.length === 0}
            >
              {freezeMutation.isPending ? 'Congelamento…' : 'Congela pianificazione'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ConfirmDialog closes itself (onOpenChange(false)) synchronously right after onConfirm
          fires, before `isPending` can turn true — so there's no `isLoading` to pass here. The
          "Congelamento…" state is shown on the trigger button behind it, which stays mounted. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Congelare la pianificazione?"
        description="Salva uno snapshot immutabile delle date correnti come baseline — da questo momento lo scostamento piano/realtà si misura contro queste date, non più contro quelle live dell'evento. Operazione irreversibile senza uno scongelamento amministrativo."
        confirmText="Congela"
        cancelText="Annulla"
        actionType="warning"
        onConfirm={() => freezeMutation.mutate({ planningGroupId })}
      />
    </>
  );
}
