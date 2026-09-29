'use client';

import { type CalendarDate, formatCalendarDate } from '@luke/core';

import { eventDays } from '../../utils';

import { EventTimelineDrag } from './EventTimelineDrag';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

interface Props {
  event: CalendarEventItem;
  /** The event's first date as the user is moving it (`eventDays`). */
  draftDate: CalendarDate;
  onDraftDateChange: (d: CalendarDate) => void;
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
          {formatCalendarDate(draftDate, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <EventTimelineDrag
        anchorDate={eventDays(event)[0]}
        value={draftDate}
        onChange={onDraftDateChange}
        holidayDates={holidayDates}
        closedDates={closedDates}
      />
    </div>
  );
}
