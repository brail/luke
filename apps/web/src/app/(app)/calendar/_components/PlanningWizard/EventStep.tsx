'use client';

import { Button } from '../../../../../components/ui/button';
import { describeAnchorScope } from '../../utils';

import { EventTimelineDrag } from './EventTimelineDrag';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

interface Props {
  event: CalendarEventItem;
  draftDate: Date;
  onDraftDateChange: (d: Date) => void;
  holidayDates: HolidayMap;
  closedDates: Set<string>;
  onOpenAnchor: () => void;
}

/** One wizard step: review/adjust a single calendar event's date and its row scope (fork). */
export function EventStep({ event, draftDate, onDraftDateChange, holidayDates, closedDates, onOpenAnchor }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{event.title}</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {draftDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onOpenAnchor}>
          Ambito: {describeAnchorScope(event.anchors)}
        </Button>
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
