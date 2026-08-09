'use client';

import { EventTimelineDrag } from './EventTimelineDrag';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

interface Props {
  event: CalendarEventItem;
  draftDate: Date;
  onDraftDateChange: (d: Date) => void;
  holidayDates: HolidayMap;
  closedDates: Set<string>;
}

/** One wizard step: review/adjust a single calendar event's date. */
export function EventStep({ event, draftDate, onDraftDateChange, holidayDates, closedDates }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium truncate">{event.title}</h3>
        <p className="text-xs text-muted-foreground tabular-nums">
          {draftDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <EventTimelineDrag
        anchorDate={new Date(event.startAt)}
        value={draftDate}
        onChange={onDraftDateChange}
        holidayDates={holidayDates}
        closedDates={closedDates}
      />
    </div>
  );
}
