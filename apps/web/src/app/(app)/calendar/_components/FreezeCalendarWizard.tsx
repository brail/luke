'use client';

import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { describeAnchorScope, toUtcIsoDate } from '../utils';

import { EventAnchorDialog } from './EventAnchorDialog';

import type { CalendarEventItem } from './types';
import type { HolidayMap } from './useHolidays';

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

/**
 * Confirms freezing a season calendar's baseline: snapshots every event's current startAt/endAt
 * into baselineStartAt/baselineEndAt (immutable, written once). startAt/endAt remain freely
 * editable afterwards — only this baseline snapshot is locked, for measuring plan-vs-actual drift.
 *
 * Row-scope selection (which rows an event applies to) is deferred — freezing always snapshots
 * the whole calendar for now.
 *
 * @param milestones - Events currently in the calendar, used for the summary and holiday warnings.
 * @param holidayDates - Holiday map used to warn when an event falls on a holiday.
 * @param onFrozen - Called after the calendar is successfully frozen.
 */
export function FreezeCalendarWizard({ open, onClose, onFrozen, calendarId, brandId, seasonId, milestones, holidayDates, onAnchorsChanged }: Props) {
  const [anchorEventId, setAnchorEventId] = useState<string | null>(null);
  const anchorEvent = milestones.find(m => m.id === anchorEventId) ?? null;

  const freezeMutation = trpc.seasonCalendar.freezeCalendar.useMutation({
    onSuccess: () => {
      toast.success('Calendario congelato — baseline salvata');
      onFrozen();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err, { CONFLICT: 'Calendario già congelato' })),
  });

  const milestonesWithHolidayFlag = milestones.map(m => ({
    milestone: m,
    onHoliday: holidayDates.has(toUtcIsoDate(new Date(m.startAt))),
  }));
  const eventsOnHolidayCount = milestonesWithHolidayFlag.filter(m => m.onHoliday).length;

  return (
    <>
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Congela pianificazione</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Salva uno snapshot immutabile delle date correnti di tutti gli eventi ({milestones.length}) come
            baseline "in teoria". Le date degli eventi restano modificabili dopo il congelamento — solo lo
            snapshot resta fisso, per misurare in futuro lo scostamento tra piano e realtà.
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs text-muted-foreground"
                    onClick={() => setAnchorEventId(m.id)}
                  >
                    {describeAnchorScope(m.anchors)}
                  </Button>
                </div>
              ))}
              {milestones.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">Nessun evento nel calendario</p>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={freezeMutation.isPending}>
            Annulla
          </Button>
          <Button
            onClick={() => freezeMutation.mutate({ calendarId })}
            disabled={freezeMutation.isPending || milestones.length === 0}
          >
            {freezeMutation.isPending ? 'Congelamento…' : 'Congela pianificazione'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {anchorEvent && (
        <EventAnchorDialog
          key={anchorEvent.id}
          open={!!anchorEventId}
          onClose={() => setAnchorEventId(null)}
          onSaved={() => { setAnchorEventId(null); onAnchorsChanged(); }}
          eventId={anchorEvent.id}
          eventTitle={anchorEvent.title}
          brandId={brandId}
          seasonId={seasonId}
          currentAnchors={anchorEvent.anchors ?? []}
        />
      )}
    </>
  );
}
