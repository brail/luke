'use client';

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import { ReactNode, useCallback, useMemo, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/popover';
import { cn } from '../../../../lib/utils';
import { DAY_LABELS_IT, MONTH_NAMES_IT, STATUS_OPACITY } from '../constants';
import { addDays, addMonths, canEditMilestone, daysBetween, getIsoWeek, groupEventsByDay, mondayOf, resolveBrandColor, sameDay, startOfDay } from '../utils';

import { DraggableEventChip } from './DraggableEventChip';
import { type CalendarEventItem as CalendarEvent } from './types';
import { type HolidayMap } from './useHolidays';

interface Props {
  milestones: CalendarEvent[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onEventClick: (id: string) => void;
  onEventUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  onDayNumberClick?: (isoDate: string) => void;
  onWeekNumberClick?: (isoDate: string) => void;
  activeBrandId?: string;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
  holidayDates?: HolidayMap;
}

const MAX_CHIPS = 3;

function MonthDayCell({ dayIso, isToday, isDragging, isCurrentMonth, holidays, onDayClick, children }: {
  dayIso: string; isToday: boolean; isDragging: boolean; isCurrentMonth: boolean; holidays?: import('./useHolidays').HolidayEntry[]; onDayClick?: () => void; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayIso });
  const isHoliday = !!holidays?.length;
  return (
    <div ref={setNodeRef} onClick={onDayClick} className={cn(
      'flex-1 min-w-0 min-h-[90px] p-1 flex flex-col border-r last:border-r-0',
      !isCurrentMonth && 'bg-muted/30',
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
 * Month grid calendar view with dnd-kit drag-and-drop for rescheduling events.
 *
 * Shows a 6-week grid (42 cells). Each cell renders up to `MAX_CHIPS` (3) event
 * chips; overflow is indicated with a "+N altri" button. Holiday cells are
 * highlighted in rose. Week number clicks navigate to the week view.
 *
 * @param onEventUpdate - Called after a drag completes with new ISO timestamps.
 * @param onDayClick - Called with the ISO date string of an empty day click.
 * @param onDayNumberClick - Called with the ISO date to navigate to day view.
 * @param onWeekNumberClick - Called with the ISO date of Monday to navigate to week view.
 * @param activeBrandId - Dims events that belong to a different brand.
 * @param brandColorMap - Pre-computed brand-ID→colour map.
 * @param holidayDates - HolidayMap used to shade holiday cells.
 */
export function CalendarEventMonthView({ milestones, viewDate, onViewDateChange, onEventClick, onEventUpdate, onNoteClick, onDayClick, onDayNumberClick, onWeekNumberClick, activeBrandId, canUpdate, brandColorMap, holidayDates }: Props) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const gridStart = useMemo(() => mondayOf(new Date(year, month, 1)), [year, month]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const today = useMemo(() => new Date(), []);

  const byDay = useMemo(() => groupEventsByDay(milestones, cells), [milestones, cells]);

  const draggingEvent = useMemo(() => milestones.find(m => m.id === draggingId), [milestones, draggingId]);
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
          <Button variant="ghost" size="icon-sm" onClick={() => onViewDateChange(addMonths(viewDate, -1))}><ChevronLeft size={14} /></Button>
          <span className="text-sm font-medium flex-1 text-center">{MONTH_NAMES_IT[month]} {year}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => onViewDateChange(addMonths(viewDate, 1))}><ChevronRight size={14} /></Button>
          <Button variant="outline" size="xs" onClick={() => onViewDateChange(new Date())}>Oggi</Button>
        </div>

        <div className="flex border-b">
          <div className="w-7 shrink-0 border-r border-border/40" />
          {DAY_LABELS_IT.map(d => (
            <div key={d} className="flex-1 min-w-0 px-2 py-1 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>

        <div className="flex-1">
          {Array.from({ length: 6 }, (_, rowIdx) => {
            const weekDays = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
            const weekNum = getIsoWeek(weekDays[0]!);
            return (
              <div key={rowIdx} className="flex border-b last:border-b-0">
                <div className="w-7 shrink-0 flex items-center justify-center border-r border-border/40 bg-muted/10">
                  <span
                    className={cn('text-[11px] font-medium text-muted-foreground/40 select-none', onWeekNumberClick && 'cursor-pointer hover:text-muted-foreground')}
                    onClick={onWeekNumberClick ? () => onWeekNumberClick(weekDays[0]!.toISOString()) : undefined}
                  >
                    {weekNum}
                  </span>
                </div>
                {weekDays.map((day, dayIdx) => {
                  const cellIdx = rowIdx * 7 + dayIdx;
                  const isCurrentMonth = day.getMonth() === month;
                  const isToday = sameDay(day, today);
                  const items = byDay[cellIdx] ?? [];
                  const overflow = items.length - MAX_CHIPS;
                  return (
                    <MonthDayCell key={dayIdx} dayIso={day.toISOString()} isToday={isToday} isDragging={!!draggingId} isCurrentMonth={isCurrentMonth} holidays={holidayDates?.get(day.toISOString().slice(0, 10))} onDayClick={onDayClick ? () => onDayClick(day.toISOString()) : undefined}>
                      <div className="mb-0.5 flex items-center gap-0.5 flex-wrap">
                        <span
                          className={cn('text-xs inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0',
                            isToday && 'bg-blue-500 text-white font-semibold',
                            !isToday && !isCurrentMonth && 'text-muted-foreground/50',
                            !isToday && isCurrentMonth && 'text-muted-foreground',
                            onDayNumberClick && 'cursor-pointer hover:ring-1 hover:ring-muted-foreground/40')}
                          onClick={onDayNumberClick ? (e) => { e.stopPropagation(); onDayNumberClick(day.toISOString()); } : undefined}
                        >
                          {day.getDate()}
                        </span>
                        {holidayDates?.get(day.toISOString().slice(0, 10))?.map((h, hi) => (
                          <span key={hi} className="text-[8px] font-mono font-semibold text-rose-500 leading-none" title={h.nameEn ?? h.name}>{h.countryCode}</span>
                        ))}
                      </div>
                      <div className="space-y-0.5 flex-1">
                        {items.slice(0, MAX_CHIPS).map(m => {
                          const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                          const start = new Date(m.startAt);
                          const end = m.endAt ? new Date(m.endAt) : null;
                          const isStart = sameDay(start, day);
                          const span = end ? daysBetween(start, end) : 0;
                          const hasNote = !!(m.notes?.[0]?.body);
                          const color = resolveBrandColor(m.brandId, brandColorMap);
                          return (
                            <div key={m.id} className={cn(isOtherBrand && 'opacity-40')}>
                              {canEditMilestone(m, canUpdate, activeBrandId) && isStart ? (
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
                              ) : (
                                <div className="relative group/plain">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                                    className={cn('w-full text-left rounded px-1 py-0.5 text-[11px] text-white truncate leading-tight',
                                      'hover:brightness-110 transition-all',
                                      STATUS_OPACITY[m.status] ?? 'opacity-100',
                                      !isStart && 'opacity-40',
                                      onNoteClick && isStart && 'pr-4')}
                                    style={{ background: color }}
                                    title={m.title}
                                  >
                                    {isStart ? m.title : '↳'}
                                  </button>
                                  {onNoteClick && isStart && (
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
                              )}
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                onClick={e => e.stopPropagation()}
                                className="text-[10px] text-muted-foreground px-1 py-0.5 hover:text-foreground hover:bg-muted/50 rounded transition-colors w-full text-left"
                              >
                                +{overflow} altri
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-2" onClick={e => e.stopPropagation()}>
                              <div className="text-[11px] font-medium text-muted-foreground mb-2">
                                {day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                              </div>
                              <div className="space-y-1">
                                {items.map(ev => {
                                  const evColor = resolveBrandColor(ev.brandId, brandColorMap);
                                  return (
                                    <button
                                      key={ev.id}
                                      type="button"
                                      onClick={() => onEventClick(ev.id)}
                                      className={cn('w-full text-left rounded px-1.5 py-0.5 text-[11px] text-white truncate leading-tight hover:brightness-110 transition-all', STATUS_OPACITY[ev.status] ?? 'opacity-100')}
                                      style={{ background: evColor }}
                                      title={ev.title}
                                    >
                                      {ev.title}
                                    </button>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </MonthDayCell>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {draggingEvent && (
          <div className="rounded px-1.5 py-0.5 text-xs text-white truncate shadow-lg opacity-90 cursor-grabbing"
            style={{ background: resolveBrandColor(draggingEvent.brandId, brandColorMap), minWidth: 80 }}>
            {draggingEvent.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
