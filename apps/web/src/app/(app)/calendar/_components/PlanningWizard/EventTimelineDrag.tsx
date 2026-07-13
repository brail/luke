'use client';

import { useMemo, useRef, useState } from 'react';

import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { cn } from '../../../../../lib/utils';
import { addDays, toUtcIsoDate } from '../../utils';

import type { HolidayMap } from '../useHolidays';

const CELL_WIDTH = 32;
// 19 cells * 32px = 608px, fits within the dialog's ~672px content width (720px - 2*24px padding).
const WINDOW_HALF = 9;
const MAX_SEARCH_DAYS = 90;

interface Props {
  /** Original event date — keeps the visible window stable while the user drags `value` around. */
  anchorDate: Date;
  value: Date;
  onChange: (d: Date) => void;
  holidayDates: HolidayMap;
  /** ISO dates ('YYYY-MM-DD') closed for the vendor(s) relevant to this event's anchored rows. */
  closedDates: Set<string>;
}

function isBlocked(iso: string, holidayDates: HolidayMap, closedDates: Set<string>): boolean {
  return holidayDates.has(iso) || closedDates.has(iso);
}

/**
 * Single-row draggable timeline: a marker for the event's draft date over a strip of days shaded
 * for public holidays / vendor closures. Drag the marker or click a day cell to move it; when the
 * current date lands on a blocked day, a shortcut jumps to the next free one.
 */
export function EventTimelineDrag({ anchorDate, value, onChange, holidayDates, closedDates }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const days = useMemo(
    () => Array.from({ length: WINDOW_HALF * 2 + 1 }, (_, i) => addDays(anchorDate, i - WINDOW_HALF)),
    [anchorDate]
  );

  const valueIso = toUtcIsoDate(value);
  const valueIndex = days.findIndex(d => toUtcIsoDate(d) === valueIso);
  const blocked = isBlocked(valueIso, holidayDates, closedDates);

  const nextFreeDate = useMemo(() => {
    if (!blocked) return null;
    for (let i = 1; i <= MAX_SEARCH_DAYS; i++) {
      const candidate = addDays(value, i);
      if (!isBlocked(toUtcIsoDate(candidate), holidayDates, closedDates)) return candidate;
    }
    return null;
  }, [blocked, value, holidayDates, closedDates]);

  const commitDrag = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dayOffset = Math.round((clientX - rect.left) / CELL_WIDTH);
    const clamped = Math.max(0, Math.min(days.length - 1, dayOffset));
    onChange(days[clamped]!);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="event-drag-exact-date" className="text-xs text-muted-foreground font-normal shrink-0">
          Data esatta
        </Label>
        {/* The strip below only spans ±{WINDOW_HALF} days around the original date — reaching a
            date further out otherwise means repeated "sposta al prossimo libero" clicks. */}
        <Input
          id="event-drag-exact-date"
          type="date"
          value={valueIso}
          onChange={e => {
            if (!e.target.value) return;
            onChange(new Date(`${e.target.value}T00:00:00`));
          }}
          inputSize="sm"
          className="w-40 [&::-webkit-datetime-edit-fields-wrapper]:text-muted-foreground"
        />
      </div>

      <div
        ref={stripRef}
        className="relative flex border rounded-md overflow-hidden select-none"
        style={{ height: 56 }}
      >
        {days.map(d => {
          const iso = toUtcIsoDate(d);
          const dayBlocked = isBlocked(iso, holidayDates, closedDates);
          return (
            <div
              key={iso}
              onClick={() => onChange(d)}
              className={cn(
                'flex flex-col items-center justify-center text-[10px] border-r last:border-r-0 cursor-pointer shrink-0',
                dayBlocked ? 'bg-amber-100 hover:bg-amber-200' : 'hover:bg-muted/50'
              )}
              style={{ width: CELL_WIDTH }}
            >
              <span className="text-muted-foreground">{d.toLocaleDateString('it-IT', { weekday: 'narrow' })}</span>
              <span className="tabular-nums">{d.getDate()}</span>
            </div>
          );
        })}

        {valueIndex >= 0 && (
          <div
            role="button"
            aria-label="Sposta evento"
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setIsDragging(true);
            }}
            onPointerMove={e => {
              if (!isDragging) return;
              commitDrag(e.clientX);
            }}
            onPointerUp={() => setIsDragging(false)}
            className={cn(
              'absolute top-0 flex items-center justify-center text-white text-xs font-medium rounded cursor-grab active:cursor-grabbing',
              blocked ? 'bg-destructive' : 'bg-emerald-600'
            )}
            style={{ left: valueIndex * CELL_WIDTH, width: CELL_WIDTH, height: 56 }}
          >
            ▲
          </div>
        )}
      </div>

      {blocked && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 border border-destructive/20 px-3 py-1.5 text-xs text-destructive">
          <span>Data su giorno festivo o chiusura fornitore</span>
          {nextFreeDate && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs border-destructive/30"
              onClick={() => onChange(nextFreeDate)}
            >
              Sposta al {nextFreeDate.toLocaleDateString('it-IT')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
