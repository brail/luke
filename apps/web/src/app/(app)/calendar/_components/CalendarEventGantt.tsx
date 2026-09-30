'use client';

import { StickyNote } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addCalendarDays, calendarDaysBetween, type CalendarDate, formatCalendarDate, isWorkingDate } from '@luke/core';

import { cn } from '../../../../lib/utils';
import { MONTH_NAMES_SHORT_IT, cancelledClass } from '../constants';
import { canEditMilestone, cellDate, eventDays, formatVisibleFunctions, groupBadge, groupTooltip, moveEvent, parseLocalIsoDate, resizeEvent, resolveBrandColor, sortByFirstDay } from '../utils';

import { type CalendarEventItem as CalendarEvent } from './types';
import { type HolidayMap } from './useHolidays';

interface Props {
  milestones: CalendarEvent[];
  onEventClick: (id: string) => void;
  /** A resize sends `endAt` alone: the start of a resized event is never rewritten. */
  onEventUpdate: (id: string, data: { startAt?: string; endAt?: string | null }) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  activeBrandId?: string;
  functionsById: Record<string, string>;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
  holidayDates?: HolidayMap;
  /** Shows a fixed-width group-initials badge on each row — only worth the visual cost when the
   * current view actually mixes events from >1 planning group. */
  showGroupBadge?: boolean;
}

const ROW_H = 36;
const LABEL_W = 200;
const DAY_W_LARGE = 24;
const DAY_W_SMALL = 13;
const MONTH_ROW_H = 22;
const DAY_ROW_H = 26;
const HEADER_H = MONTH_ROW_H + DAY_ROW_H;

const FMT = (d: CalendarDate) => formatCalendarDate(d, { day: 'numeric', month: 'short' });

/** The dates `m` would occupy after a drag or resize by `dayDelta` — derived from the change that
 * would be sent, so the preview can never disagree with the result. */
function previewDays(m: CalendarEvent, dayDelta: number, mode: 'drag' | 'resize'): [CalendarDate, CalendarDate] {
  const change = mode === 'drag' ? moveEvent(m, dayDelta) : resizeEvent(m, dayDelta);
  return eventDays(change ? { ...m, ...change } : m);
}

function dragLabel([first, last]: [CalendarDate, CalendarDate], mode: 'drag' | 'resize'): string {
  if (mode === 'drag') return first === last ? FMT(first) : `${FMT(first)} – ${FMT(last)}`;
  return `→ ${FMT(last)} (${calendarDaysBetween(first, last) + 1} gg)`;
}

type DragState = { id: string; mode: 'drag' | 'resize'; startX: number; deltaX: number };

/**
 * Gantt-chart view for calendar events with drag-to-move and drag-to-resize.
 *
 * The time axis auto-scales: when the range exceeds 150 days the day columns
 * shrink from 24 px to 13 px. Holiday dates are highlighted with a coloured
 * background. Dragging snaps to full-day resolution.
 *
 * @param functionsById - Map of function ID → name, used as row labels.
 * @param onEventUpdate - Called after a drag completes with new ISO timestamps.
 * @param onDayClick - Called with the clicked day's ISO date string.
 * @param activeBrandId - Dims events that belong to a different brand.
 * @param brandColorMap - Pre-computed brand-ID→colour map.
 * @param holidayDates - HolidayMap used to shade holiday columns.
 */
export function CalendarEventGantt({ milestones, onEventClick, onEventUpdate, onNoteClick, onDayClick, activeBrandId, functionsById, canUpdate, brandColorMap, holidayDates, showGroupBadge }: Props) {
  const sorted = useMemo(
    () => sortByFirstDay(milestones),
    [milestones]
  );

  const { rangeStart, totalDays, dayW, months } = useMemo(() => {
    // The axis is calendar dates: one column per date, whatever the length of the local day.
    if (sorted.length === 0) {
      return { rangeStart: cellDate(new Date()), totalDays: 90, dayW: DAY_W_LARGE, months: [] as { label: string; startDay: number; width: number }[] };
    }
    const spans = sorted.map(eventDays);
    const minDate = spans.reduce((a, [first]) => first < a ? first : a, spans[0]![0]);
    const maxDate = spans.reduce((a, [, last]) => last > a ? last : a, spans[0]![1]);
    const rangeStart = addCalendarDays(minDate, -7);
    const totalDays = Math.max(calendarDaysBetween(rangeStart, addCalendarDays(maxDate, 14)), 30);
    const dayW = totalDays > 150 ? DAY_W_SMALL : DAY_W_LARGE;
    const months: { label: string; startDay: number; width: number }[] = [];
    let day = 0;
    while (day < totalDays) {
      const month = addCalendarDays(rangeStart, day).slice(0, 7);
      let count = 1;
      while (day + count < totalDays && addCalendarDays(rangeStart, day + count).startsWith(month)) count++;
      months.push({ label: `${MONTH_NAMES_SHORT_IT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`, startDay: day, width: count * dayW });
      day += count;
    }
    return { rangeStart, totalDays, dayW, months };
  }, [sorted]);

  const dayMeta = useMemo(() =>
    Array.from({ length: totalDays }, (_, i) => {
      const date = addCalendarDays(rangeStart, i);
      const dayNum = Number(date.slice(8));
      // No holidays passed: not a working date means Saturday or Sunday.
      return { date, dayNum, isWeekend: !isWorkingDate(date, [], []), isMonthStart: i > 0 && dayNum === 1, monthIndex: Number(date.slice(5, 7)) - 1 };
    }), [rangeStart, totalDays]);

  const monthBoundaries = useMemo(() =>
    dayMeta.flatMap((d, i) => d.isMonthStart ? [i * dayW] : []),
    [dayMeta, dayW]);

  const weekendOffsets = useMemo(() =>
    dayMeta.flatMap((d, i) => d.isWeekend ? [i * dayW] : []),
    [dayMeta, dayW]);

  const holidayOffsets = useMemo(() => {
    if (!holidayDates) return [];
    return dayMeta.flatMap((d, i) => {
      const entries = holidayDates.get(d.date);
      return entries?.length ? [{ x: i * dayW, entries }] : [];
    });
  }, [dayMeta, dayW, holidayDates]);

  const totalW = totalDays * dayW;
  const todayOffset = calendarDaysBetween(rangeStart, cellDate(new Date()));
  const showToday = todayOffset >= 0 && todayOffset < totalDays;

  /** Where a bar covering `[first, last]` sits on the axis, both ends included. */
  const box = useCallback(([first, last]: [CalendarDate, CalendarDate]) => ({
    left: calendarDaysBetween(rangeStart, first) * dayW,
    width: (calendarDaysBetween(first, last) + 1) * dayW,
  }), [rangeStart, dayW]);

  const bars = useMemo(() =>
    sorted.map(m => {
      const days = eventDays(m);
      const visibleFunctionNames = formatVisibleFunctions(m.visibilities, functionsById);
      return { ...m, ...box(days), days, visibleFunctionNames };
    }), [sorted, box, functionsById]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const wasDraggingRef = useRef(false);
  const eventsRef = useRef(milestones);
  useEffect(() => { eventsRef.current = milestones; }, [milestones]);

  const startDrag = useCallback((e: React.PointerEvent, id: string, mode: 'drag' | 'resize') => {
    if (!canUpdate) return;
    e.preventDefault();
    e.stopPropagation();
    const state: DragState = { id, mode, startX: e.clientX, deltaX: 0 };
    dragRef.current = state;
    setDrag(state);
    const onMove = (ev: PointerEvent) => { dragRef.current = { ...state, deltaX: ev.clientX - state.startX }; setDrag({ ...state, deltaX: ev.clientX - state.startX }); };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dayDelta = Math.round((ev.clientX - state.startX) / dayW);
      if (dayDelta === 0) { setDrag(null); dragRef.current = null; return; }
      wasDraggingRef.current = true;
      const m = eventsRef.current.find(x => x.id === id);
      const change = m && (mode === 'drag' ? moveEvent(m, dayDelta) : resizeEvent(m, dayDelta));
      if (change) onEventUpdate(id, change);
      setDrag(null);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [canUpdate, dayW, onEventUpdate]);

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <div style={{ minWidth: LABEL_W + totalW }}>

        <div className="flex border-b" style={{ height: HEADER_H }}>
          <div className="shrink-0 sticky left-0 z-10 bg-background border-r flex flex-col justify-end px-3 pb-1" style={{ width: LABEL_W, height: HEADER_H }}>
            <span className="text-xs font-medium text-muted-foreground">Evento</span>
          </div>
          <div className="relative flex-1" style={{ height: HEADER_H }}>
            <div style={{ width: totalW, height: HEADER_H, position: 'relative' }}>
              {months.map((seg, i) => (
                <div key={i} className={cn('absolute flex items-center px-2', i % 2 === 0 ? 'bg-muted/10' : 'bg-muted/25', i > 0 && 'border-l-2 border-l-border/60')}
                  style={{ left: seg.startDay * dayW, width: seg.width, top: 0, height: MONTH_ROW_H }}>
                  {/* 11px: below Tailwind's text-xs (12px) floor; dense gantt month label */}
                  <span className="text-[11px] font-semibold text-foreground/60 whitespace-nowrap">{seg.label}</span>
                </div>
              ))}
              <div className="absolute left-0 flex border-t border-border/30" style={{ top: MONTH_ROW_H, height: DAY_ROW_H, width: totalW }}>
                {dayMeta.map((d, i) => {
                  const isToday = i === todayOffset;
                  const evenMonth = d.monthIndex % 2 === 0;
                  return (
                    <div key={i} className={cn('shrink-0 flex items-center justify-center',
                      d.isMonthStart ? 'border-l-2 border-l-border/60' : 'border-l border-l-border/15',
                      d.isWeekend ? 'bg-muted/50' : (evenMonth ? 'bg-muted/10' : 'bg-muted/25'),
                      isToday && '!bg-blue-50 dark:!bg-blue-950/40')}
                      style={{ width: dayW, height: DAY_ROW_H }}>
                      <span className={cn('tabular-nums select-none leading-none',
                        // 8px/11px: below Tailwind's text-xs (12px) floor; density scales with day-column width
                        dayW >= DAY_W_LARGE ? 'text-[11px]' : 'text-[8px]',
                        isToday ? 'text-blue-500 font-bold' : 'text-muted-foreground/60',
                        d.isMonthStart && !isToday && 'font-semibold text-foreground/50')}>
                        {d.dayNum}
                      </span>
                    </div>
                  );
                })}
              </div>
              {showToday && <div className="absolute top-0 bottom-0 bg-blue-400/15 dark:bg-blue-500/15 pointer-events-none" style={{ left: todayOffset * dayW, width: dayW }} />}
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute pointer-events-none" style={{ left: LABEL_W, top: 0, width: totalW, height: bars.length * ROW_H }}>
            {weekendOffsets.map((x, wi) => <div key={wi} className="absolute inset-y-0 bg-muted/40" style={{ left: x, width: dayW }} />)}
            {holidayOffsets.map(({ x }, hi) => (
              <div key={hi} className="absolute inset-y-0 bg-rose-200/40 dark:bg-rose-950/20" style={{ left: x, width: dayW }} />
            ))}
            {monthBoundaries.map((x, mi) => <div key={mi} className="absolute inset-y-0 w-0.5 bg-border/60" style={{ left: x }} />)}
            {showToday && <div className="absolute inset-y-0 bg-blue-400/10 dark:bg-blue-500/10" style={{ left: todayOffset * dayW, width: dayW }} />}
          </div>

          {bars.map((m, i) => {
            const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
            const isDragging = drag?.id === m.id;
            const dayDeltaPreview = isDragging ? Math.round(drag.deltaX / dayW) : 0;
            const preview = isDragging && dayDeltaPreview !== 0 ? previewDays(m, dayDeltaPreview, drag.mode) : null;
            const { left: previewLeft, width: previewWidth } = preview ? box(preview) : m;
            const barColor = resolveBrandColor(m.brandId, brandColorMap);
            const label = isDragging ? dragLabel(preview ?? m.days, drag.mode) : null;
            const hasNote = !!(m.notes?.[0]?.body);
            const badge = groupBadge(showGroupBadge, m.planningGroupName);

            return (
              <div key={m.id} className={cn('flex group hover:bg-muted/20 transition-colors', isOtherBrand && 'opacity-40')} style={{ height: ROW_H }}>
                  <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                  className={cn('shrink-0 sticky left-0 z-10 bg-background group-hover:bg-muted/20', 'border-r text-left px-3 flex items-center gap-2 min-w-0 transition-colors', i < bars.length - 1 && 'border-b border-border/40')}
                  style={{ width: LABEL_W, height: ROW_H }}
                >
                  {m.brandId && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: barColor }} />}
                  {/* 10px: below Tailwind's text-xs (12px) floor; dense gantt badge */}
                  {badge && <span className="text-[10px] font-semibold text-muted-foreground shrink-0">{badge}</span>}
                  <span className="truncate text-sm font-medium flex-1 min-w-0" title={m.planningGroupName ? groupTooltip(m.planningGroupName, m.title) : undefined}>{m.title}</span>
                  {onNoteClick && (
                    <span
                      onClick={(e) => { e.stopPropagation(); onNoteClick(m.id); }}
                      className={cn('p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0', hasNote ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')}
                      role="button"
                      title="Note personali"
                    >
                      <StickyNote size={12} />
                    </span>
                  )}
                </button>

                  <div
                  className={cn('relative flex-1', i < bars.length - 1 && 'border-b border-border/40')}
                  style={{ height: ROW_H, overflow: 'visible' }}
                  onClick={(e) => {
                    if (wasDraggingRef.current) return;
                    if (!onDayClick) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const dayIndex = Math.floor((e.clientX - rect.left) / dayW);
                    if (dayIndex >= 0 && dayIndex < totalDays) onDayClick(parseLocalIsoDate(addCalendarDays(rangeStart, dayIndex))!.toISOString());
                  }}
                >
                  <div style={{ width: totalW, height: ROW_H, position: 'relative', overflow: 'visible' }}>
                    {isDragging && (
                      <div className="absolute top-1/2 -translate-y-1/2 rounded pointer-events-none"
                        style={{ left: m.left, width: m.width, height: 22, background: barColor, opacity: 0.15, outline: `1px dashed ${barColor}`, outlineOffset: 1 }} />
                    )}
                    <div
                      className={cn('absolute top-1/2 -translate-y-1/2 rounded', 'text-white text-xs font-medium whitespace-nowrap',
                        cancelledClass(!!m.cancelledAt),
                        isDragging ? 'shadow-lg z-20 cursor-grabbing' : cn(canUpdate && 'cursor-grab'))}
                      style={{ left: previewLeft, width: previewWidth, height: 22, background: barColor, userSelect: 'none', overflow: 'visible' }}
                      onPointerDown={canEditMilestone(m, canUpdate, activeBrandId) ? e => startDrag(e, m.id, 'drag') : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
                        onEventClick(m.id);
                      }}
                      title={groupTooltip(m.planningGroupName, m.title, ` — ${m.visibleFunctionNames}`)}
                    >
                      {/* leading-[22px] matches ROW_H so the title vertically centers in the gantt bar; no scale equivalent */}
                      <span className="px-1.5 leading-[22px] block select-none pointer-events-none" style={{ overflow: 'hidden', width: previewWidth }}>
                        {previewWidth > 56 && m.title}
                      </span>
                      {isDragging && label && (
                        <div className="absolute left-0 pointer-events-none z-30" style={{ bottom: 26 }}>
                          {/* 10px: below Tailwind's text-xs (12px) floor; dense gantt tooltip */}
                          <span className="text-[10px] bg-popover text-popover-foreground border rounded px-1.5 py-0.5 shadow-md whitespace-nowrap font-medium">{label}</span>
                        </div>
                      )}
                      {canEditMilestone(m, canUpdate, activeBrandId) && !isDragging && (
                        <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/25 rounded-r"
                          onPointerDown={e => startDrag(e, m.id, 'resize')}
                          onClick={e => e.stopPropagation()} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
