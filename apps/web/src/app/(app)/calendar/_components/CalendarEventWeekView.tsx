'use client';

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import { type CSSProperties, ReactNode, useCallback, useMemo, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { DAY_LABELS_IT, STATUS_OPACITY } from '../constants';
import { addDays, canEditMilestone, daysBetween, getIsoWeek, groupEventsByDay, mondayOf, resolveBrandColor, sameDay, startOfDay } from '../utils';

import { DraggableEventChip } from './DraggableEventChip';
import { type CalendarEventItem as CalendarEvent } from './types';
import { type HolidayEntry, type HolidayMap } from './useHolidays';

interface Props {
  milestones: CalendarEvent[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onEventClick: (id: string) => void;
  onEventUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  onDayNumberClick?: (isoDate: string) => void;
  activeBrandId?: string;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
  holidayDates?: HolidayMap;
}

function WeekDayRow({ dayIso, isToday, isWeekend, isDragging, holidays, onDayClick, children }: {
  dayIso: string; isToday: boolean; isWeekend: boolean; isDragging: boolean; holidays?: HolidayEntry[]; onDayClick?: () => void; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayIso });
  const isHoliday = !!holidays?.length;
  return (
    <div ref={setNodeRef} onClick={onDayClick} className={cn(
      'flex-1 p-1.5 flex flex-wrap gap-1 content-start min-h-[52px]',
      isWeekend && 'bg-muted/20',
      isHoliday && 'bg-rose-50 dark:bg-rose-950/20',
      isToday && 'bg-blue-50/50 dark:bg-blue-950/20',
      isDragging && isOver && 'bg-blue-50/80 dark:bg-blue-950/30 ring-1 ring-inset ring-blue-300/50',
      onDayClick && 'cursor-pointer',
    )}>
      {children}
    </div>
  );
}

/**
 * Week grid calendar view with dnd-kit drag-and-drop for rescheduling events.
 *
 * Renders a 7-column grid from Monday to Sunday. Each column lists event chips
 * via `DraggableEventChip`. Holiday columns are highlighted in rose. Day number
 * clicks navigate to the day view.
 *
 * @param onEventUpdate - Called after a drag completes with new ISO timestamps.
 * @param onDayClick - Called with the ISO date string of an empty cell click.
 * @param onDayNumberClick - Called with the ISO date to navigate to day view.
 * @param activeBrandId - Dims events that belong to a different brand.
 * @param brandColorMap - Pre-computed brand-ID→colour map.
 * @param holidayDates - HolidayMap used to shade holiday columns.
 */
export function CalendarEventWeekView({ milestones, viewDate, onViewDateChange, onEventClick, onEventUpdate, onNoteClick, onDayClick, onDayNumberClick, activeBrandId, canUpdate, brandColorMap, holidayDates }: Props) {
  const weekStart = useMemo(() => mondayOf(viewDate), [viewDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = useMemo(() => new Date(), []);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byDay = useMemo(() => groupEventsByDay(milestones, days), [milestones, days]);

  const weekLabel = useMemo(() => {
    const end = days[6]!;
    const wn = getIsoWeek(weekStart);
    const startFmt = weekStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const endFmt = end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    return `W${wn} · ${startFmt} – ${endFmt}`;
  }, [weekStart, days]);

  const draggingEvent = useMemo(() => milestones.find(m => m.id === draggingId), [milestones, draggingId]);
  const draggingColor = useMemo(() => draggingEvent ? resolveBrandColor(draggingEvent.brandId, brandColorMap) : undefined, [draggingEvent, brandColorMap]);
  const handleDragStart = useCallback((event: DragStartEvent) => { setDraggingId(event.active.id as string); }, []);
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(null);
    if (!event.over || !canUpdate) return;
    const m = milestones.find(x => x.id === event.active.id as string);
    if (!m) return;
    const delta = daysBetween(startOfDay(new Date(m.startAt)), startOfDay(new Date(event.over.id as string)));
    if (delta === 0) return;
    const newStart = addDays(new Date(m.startAt), delta);
    const newEnd = m.endAt ? addDays(new Date(m.endAt), delta) : undefined;
    onEventUpdate(event.active.id as string, { startAt: newStart.toISOString(), endAt: newEnd ? newEnd.toISOString() : null });
  }, [canUpdate, milestones, onEventUpdate]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <Button variant="ghost" size="icon-sm" onClick={() => onViewDateChange(addDays(weekStart, -7))}><ChevronLeft size={14} /></Button>
          <span className="text-sm font-medium flex-1 text-center">{weekLabel}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => onViewDateChange(addDays(weekStart, 7))}><ChevronRight size={14} /></Button>
          <Button variant="outline" size="xs" onClick={() => onViewDateChange(new Date())}>Oggi</Button>
        </div>

        <div className="flex-1">
          {days.map((day, i) => {
            const isToday = sameDay(day, today);
            const isWeekend = i >= 5;
            const items = byDay[i] ?? [];
            return (
              <div key={i} className={cn('flex border-b last:border-b-0', isToday && 'bg-blue-50/20 dark:bg-blue-950/10')}>
                <div className={cn('w-20 shrink-0 px-2 py-1.5 flex flex-col items-end justify-start border-r', isWeekend && 'bg-muted/20')}>
                  <span className="text-xs text-muted-foreground">{DAY_LABELS_IT[i]}</span>
                  <div className="flex items-center gap-0.5">
                    {holidayDates?.get(day.toISOString().slice(0, 10))?.map((h, hi) => (
                      <span key={hi} className="text-[8px] font-mono font-semibold text-rose-500 leading-none" title={h.nameEn ?? h.name}>{h.countryCode}</span>
                    ))}
                    <span
                      className={cn('text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full shrink-0',
                        isToday && 'bg-blue-500 text-white', !isToday && 'text-foreground',
                        onDayNumberClick && 'cursor-pointer hover:ring-1 hover:ring-muted-foreground/40')}
                      onClick={onDayNumberClick ? () => onDayNumberClick(day.toISOString()) : undefined}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                </div>
                <WeekDayRow dayIso={day.toISOString()} isToday={isToday} isWeekend={isWeekend} isDragging={!!draggingId}
                  holidays={holidayDates?.get(day.toISOString().slice(0, 10))}
                  onDayClick={canUpdate ? () => onDayClick?.(day.toISOString()) : undefined}>
                  {items.map(m => {
                    const start = new Date(m.startAt);
                    const end = m.endAt ? new Date(m.endAt) : null;
                    const isStart = sameDay(start, day);
                    const span = end ? daysBetween(start, end) : 0;
                    const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                    const hasNote = !!(m.notes?.[0]?.body);
                    const color = resolveBrandColor(m.brandId, brandColorMap);
                    const canDrag = canEditMilestone(m, canUpdate, activeBrandId) && isStart;
                    const isPlainStart = !canDrag && isStart;
                    return (
                      <div key={m.id} className={cn('shrink-0', isOtherBrand && 'opacity-40')}>
                        {canDrag ? (
                          <DraggableEventChip
                            id={m.id}
                            title={m.title}
                            status={m.status}
                            color={color}
                            span={span}
                            isDragging={draggingId === m.id}
                            hasNote={hasNote}
                            onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                            onNoteClick={onNoteClick ? (e) => { e.stopPropagation(); onNoteClick(m.id); } : undefined}
                          />
                        ) : isPlainStart ? (
                          <div className="relative group/plain">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                              className={cn('text-left rounded px-1.5 py-0.5 text-xs text-white truncate max-w-[200px] [background:var(--ev-color)]', // max-w-[200px]: prevent chip overflow in narrow week cells
                                'hover:brightness-110 transition-all',
                                STATUS_OPACITY[m.status] ?? 'opacity-100',
                                onNoteClick && 'pr-5')}
                              style={{ '--ev-color': color } as CSSProperties}
                              title={`${m.title}${span > 0 ? ` (${span + 1}gg)` : ''}`}
                            >
                              {m.title}
                            </button>
                            {onNoteClick && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onNoteClick(m.id); }}
                                className={cn('absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-white/60 hover:text-white transition-colors',
                                  hasNote ? 'opacity-100' : 'opacity-0 group-hover/plain:opacity-60')}
                                title="Note personali"
                              >
                                <StickyNote size={9} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div
                            className="flex items-center h-6 rounded-r px-1.5 text-[11px] truncate max-w-[200px] cursor-pointer hover:brightness-95 transition-all text-muted-foreground [border-left:3px_solid_var(--ev-color)]" // max-w-[200px]: prevent continuation chip overflow
                            style={{ '--ev-color': color, background: `${color}18` } as CSSProperties}
                            onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                            title={m.title}
                          >
                            <span className="truncate">{m.title}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </WeekDayRow>
              </div>
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {draggingEvent && (
          <div className="rounded px-1.5 py-0.5 text-xs text-white truncate shadow-lg opacity-90 cursor-grabbing"
            style={{ background: draggingColor, minWidth: 80 }}>
            {draggingEvent.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
