'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { MONTH_NAMES_SHORT_IT, STATUS_OPACITY } from '../constants';
import { addDays, canEditMilestone, daysBetween, resolveBrandColor, startOfDay } from '../utils';
import { type CalendarEventItem as CalendarEvent } from './types';

interface Props {
  milestones: CalendarEvent[];
  onEventClick: (id: string) => void;
  onEventUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  activeBrandId?: string;
  functionsById: Record<string, string>;
  canUpdate?: boolean;
  brandColorMap: Record<string, string>;
}

const ROW_H = 36;
const LABEL_W = 200;
const DAY_W_LARGE = 24;
const DAY_W_SMALL = 13;
const MONTH_ROW_H = 22;
const DAY_ROW_H = 26;
const HEADER_H = MONTH_ROW_H + DAY_ROW_H;

const FMT = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

function dragLabel(origStart: Date, origEnd: Date | null, dayDelta: number, mode: 'drag' | 'resize'): string {
  if (mode === 'drag') {
    const s = addDays(origStart, dayDelta);
    if (!origEnd || daysBetween(origStart, origEnd) === 0) return FMT(s);
    return `${FMT(s)} – ${FMT(addDays(origEnd, dayDelta))}`;
  }
  const base = origEnd ?? origStart;
  const raw = addDays(base, dayDelta);
  const clamped = raw < addDays(origStart, 1) ? addDays(origStart, 1) : raw;
  const dur = daysBetween(origStart, clamped) + 1;
  return `→ ${FMT(clamped)} (${dur} gg)`;
}

type DragState = { id: string; mode: 'drag' | 'resize'; startX: number; deltaX: number };

export function CalendarEventGantt({ milestones, onEventClick, onEventUpdate, onNoteClick, onDayClick, activeBrandId, functionsById, canUpdate, brandColorMap }: Props) {
  const sorted = useMemo(
    () => [...milestones].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [milestones]
  );

  const { rangeStart, totalDays, dayW, months } = useMemo(() => {
    if (sorted.length === 0) {
      const today = startOfDay(new Date());
      return { rangeStart: today, totalDays: 90, dayW: DAY_W_LARGE, months: [] as { label: string; startDay: number; width: number }[] };
    }
    const starts = sorted.map(m => startOfDay(new Date(m.startAt)));
    const ends = sorted.map(m => m.endAt ? startOfDay(new Date(m.endAt)) : startOfDay(new Date(m.startAt)));
    const minDate = starts.reduce((a, b) => a < b ? a : b);
    const maxDate = ends.reduce((a, b) => a > b ? a : b);
    const rangeStart = addDays(minDate, -7);
    const rangeEnd = addDays(maxDate, 14);
    const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 30);
    const dayW = totalDays > 150 ? DAY_W_SMALL : DAY_W_LARGE;
    const months: { label: string; startDay: number; width: number }[] = [];
    let day = 0;
    while (day < totalDays) {
      const date = new Date(rangeStart.getTime() + day * 86_400_000);
      const month = date.getMonth();
      const year = date.getFullYear();
      let count = 0;
      while (day + count < totalDays) {
        const d = new Date(rangeStart.getTime() + (day + count) * 86_400_000);
        if (d.getMonth() !== month || d.getFullYear() !== year) break;
        count++;
      }
      if (count === 0) break;
      months.push({ label: `${MONTH_NAMES_SHORT_IT[month]} ${year}`, startDay: day, width: count * dayW });
      day += count;
    }
    return { rangeStart, totalDays, dayW, months };
  }, [sorted]);

  const dayMeta = useMemo(() =>
    Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(rangeStart.getTime() + i * 86_400_000);
      const dow = d.getDay();
      return { date: d, dayNum: d.getDate(), isWeekend: dow === 0 || dow === 6, isMonthStart: i > 0 && d.getDate() === 1, monthIndex: d.getMonth() };
    }), [rangeStart, totalDays]);

  const monthBoundaries = useMemo(() =>
    dayMeta.filter(d => d.isMonthStart).map(d => daysBetween(rangeStart, d.date) * dayW),
    [dayMeta, rangeStart, dayW]);

  const weekendOffsets = useMemo(() =>
    dayMeta.filter(d => d.isWeekend).map(d => daysBetween(rangeStart, d.date) * dayW),
    [dayMeta, rangeStart, dayW]);

  const totalW = totalDays * dayW;
  const todayOffset = daysBetween(rangeStart, startOfDay(new Date()));
  const showToday = todayOffset >= 0 && todayOffset < totalDays;

  const bars = useMemo(() =>
    sorted.map(m => {
      const start = startOfDay(new Date(m.startAt));
      const end = m.endAt ? startOfDay(new Date(m.endAt)) : start;
      const left = daysBetween(rangeStart, start) * dayW;
      const spanDays = Math.max(1, daysBetween(start, end));
      const width = Math.max(spanDays * dayW, dayW);
      return { ...m, left, width, _start: start, _end: end };
    }), [sorted, rangeStart, dayW]);

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
      if (m) {
        const origStart = startOfDay(new Date(m.startAt));
        const origEnd = m.endAt ? startOfDay(new Date(m.endAt)) : origStart;
        if (mode === 'drag') {
          onEventUpdate(id, { startAt: addDays(origStart, dayDelta).toISOString(), endAt: m.endAt ? addDays(origEnd, dayDelta).toISOString() : null });
        } else {
          const minEnd = addDays(origStart, 1);
          const newEnd = addDays(origEnd, dayDelta);
          onEventUpdate(id, { startAt: origStart.toISOString(), endAt: (newEnd < minEnd ? minEnd : newEnd).toISOString() });
        }
      }
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
            {monthBoundaries.map((x, mi) => <div key={mi} className="absolute inset-y-0 w-[2px] bg-border/60" style={{ left: x }} />)}
            {showToday && <div className="absolute inset-y-0 bg-blue-400/10 dark:bg-blue-500/10" style={{ left: todayOffset * dayW, width: dayW }} />}
          </div>

          {bars.map((m, i) => {
            const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
            const isDragging = drag?.id === m.id;
            const dayDeltaPreview = isDragging ? Math.round(drag.deltaX / dayW) : 0;
            const previewLeft = drag?.mode === 'drag' && isDragging ? m.left + dayDeltaPreview * dayW : m.left;
            const previewWidth = drag?.mode === 'resize' && isDragging ? Math.max(dayW, m.width + dayDeltaPreview * dayW) : m.width;
            const barColor = resolveBrandColor(m.brandId, brandColorMap);
            const label = isDragging ? dragLabel(m._start, m.endAt ? m._end : null, dayDeltaPreview, drag.mode) : null;
            const hasNote = !!(m.notes?.[0]?.body);

            return (
              <div key={m.id} className={cn('flex group hover:bg-muted/20 transition-colors', isOtherBrand && 'opacity-40')} style={{ height: ROW_H }}>
                  <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEventClick(m.id); }}
                  className={cn('shrink-0 sticky left-0 z-10 bg-background group-hover:bg-muted/20', 'border-r text-left px-3 flex items-center gap-2 min-w-0 transition-colors', i < bars.length - 1 && 'border-b border-border/40')}
                  style={{ width: LABEL_W, height: ROW_H }}
                >
                  {m.brandId && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: barColor }} />}
                  <span className="truncate text-sm font-medium flex-1 min-w-0">{m.title}</span>
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
                    if (dayIndex >= 0 && dayIndex < totalDays) onDayClick(addDays(rangeStart, dayIndex).toISOString());
                  }}
                >
                  <div style={{ width: totalW, height: ROW_H, position: 'relative', overflow: 'visible' }}>
                    {isDragging && (
                      <div className="absolute top-1/2 -translate-y-1/2 rounded pointer-events-none"
                        style={{ left: m.left, width: m.width, height: 22, background: barColor, opacity: 0.15, outline: `1px dashed ${barColor}`, outlineOffset: 1 }} />
                    )}
                    <div
                      className={cn('absolute top-1/2 -translate-y-1/2 rounded', 'text-white text-xs font-medium whitespace-nowrap',
                        STATUS_OPACITY[m.status] ?? 'opacity-100',
                        isDragging ? 'shadow-lg z-20 cursor-grabbing' : cn(canUpdate && 'cursor-grab'))}
                      style={{ left: previewLeft, width: previewWidth, height: 22, background: barColor, userSelect: 'none', overflow: 'visible' }}
                      onPointerDown={canEditMilestone(m, canUpdate, activeBrandId) ? e => startDrag(e, m.id, 'drag') : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
                        onEventClick(m.id);
                      }}
                      title={`${m.title} — ${functionsById[m.ownerFunctionId] ?? m.ownerFunctionId}`}
                    >
                      <span className="px-1.5 leading-[22px] block select-none pointer-events-none" style={{ overflow: 'hidden', width: previewWidth }}>
                        {previewWidth > 56 && m.title}
                      </span>
                      {isDragging && label && (
                        <div className="absolute left-0 pointer-events-none z-30" style={{ bottom: 26 }}>
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
