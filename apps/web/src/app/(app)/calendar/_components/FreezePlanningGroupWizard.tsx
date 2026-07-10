'use client';

import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { toUtcIsoDate } from '../utils';

import type { CalendarEventItem } from './types';
import type { HolidayMap } from './useHolidays';

interface Props {
  open: boolean;
  onClose: () => void;
  onFrozen: () => void;
  planningGroupId: string;
  milestones: CalendarEventItem[];
  holidayDates: HolidayMap;
}

/**
 * Confirms freezing a planning group's baseline: snapshots every one of its events' current
 * startAt/endAt into baselineStartAt/baselineEndAt (immutable, written once). startAt/endAt remain
 * freely editable afterwards — only this baseline snapshot is locked, for measuring plan-vs-actual
 * drift. Events added to the group after freeze simply never get a baseline (freeze is never
 * retroactively re-applied).
 *
 * @param milestones - The planning group's events, used for the summary and holiday warnings.
 * @param holidayDates - Holiday map used to warn when an event falls on a holiday.
 * @param onFrozen - Called after the group is successfully frozen.
 */
export function FreezePlanningGroupWizard({ open, onClose, onFrozen, planningGroupId, milestones, holidayDates }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const freezeMutation = trpc.seasonCalendar.freezePlanningGroup.useMutation({
    onSuccess: () => {
      toast.success('Gruppo di pianificazione congelato — baseline salvata');
      onFrozen();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err, { CONFLICT: 'Gruppo già congelato' })),
  });

  const milestonesWithHolidayFlag = milestones.map(m => ({
    milestone: m,
    onHoliday: holidayDates.has(toUtcIsoDate(new Date(m.startAt))),
  }));
  const eventsOnHolidayCount = milestonesWithHolidayFlag.filter(m => m.onHoliday).length;

  return (
    <>
      <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent
          className="sm:max-w-[600px]"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Congela pianificazione</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Salva uno snapshot immutabile delle date correnti di tutti gli eventi ({milestones.length}) del
              gruppo di pianificazione come baseline "in teoria". Le date degli eventi restano modificabili dopo
              il congelamento — solo lo snapshot resta fisso, per misurare in futuro lo scostamento tra piano e realtà.
            </p>

            {eventsOnHolidayCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{eventsOnHolidayCount} eventi cadono su un giorno festivo</p>
                  <p className="text-xs mt-0.5">Verifica le date prima di congelare, se necessario.</p>
                </div>
              </div>
            )}

            <ScrollArea className="h-56 rounded-md border">
              <div className="p-2 space-y-1">
                {milestonesWithHolidayFlag.map(({ milestone: m, onHoliday }) => (
                  <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm">
                    <span className="flex-1 truncate">{m.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(m.startAt).toLocaleDateString('it-IT')}
                    </span>
                    {onHoliday && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">festivo</Badge>}
                  </div>
                ))}
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
        description="Salva uno snapshot immutabile delle date correnti come baseline — da questo momento lo scostamento piano/realtà si misura contro queste date, non più contro quelle live dell'evento. Operazione irreversibile senza un de-freeze amministrativo."
        confirmText="Congela"
        cancelText="Annulla"
        variant="destructive"
        actionType="warning"
        onConfirm={() => freezeMutation.mutate({ planningGroupId })}
      />
    </>
  );
}
