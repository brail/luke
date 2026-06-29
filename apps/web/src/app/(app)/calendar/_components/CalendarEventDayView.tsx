'use client';

import { ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { STATUS_OPACITY } from '../constants';
import { addDays, canEditMilestone, resolveBrandColor, sameDay } from '../utils';

import { type CalendarEventItem as CalendarEvent } from './types';

interface Props {
  milestones: CalendarEvent[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onEventClick: (id: string) => void;
  onEventUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  onNoteClick?: (id: string) => void;
  onDayClick?: (isoDate: string) => void;
  activeBrandId?: string;
  brandColorMap: Record<string, string>;
  canUpdate?: boolean;
}

const GRID_START = 7;
const GRID_END = 22;
const ROW_H = 56;
const LABEL_W = 52;
const SNAP_MIN = 15;
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);

function timeLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

type DragState = { id: string; startY: number; deltaMinutes: number; origStartAt: Date; origEndAt: Date | null };

/**
 * Hour-grid day view for calendar events, with drag-to-reschedule support.
 *
 * Displays all-day events in a banner strip and timed events in a scrollable
 * hour grid (07:00–22:00). Dragging a timed event updates `startAt`/`endAt`
 * via `onEventUpdate` in 15-minute snaps.
 *
 * @param onEventUpdate - Called after a drag completes with the new ISO timestamps.
 * @param onDayClick - Called with the ISO timestamp of the clicked hour slot.
 * @param onNoteClick - Called with the event ID to open the personal-note dialog.
 * @param activeBrandId - Dims events that belong to a different brand.
 * @param brandColorMap - Pre-computed brand-ID→colour map from `assignBrandColors`.
 */
export function CalendarEventDayView({ milestones, viewDate, onViewDateChange, onEventClick, onEventUpdate, onNoteClick, onDayClick, activeBrandId, brandColorMap, canUpdate }: Props) {
  const today = useMemo(() => new Date(), []);
  const isToday = sameDay(viewDate, today);

  const dayEvents = useMemo(() => {
    const dayStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()).getTime();
    const dayEnd = dayStart + 86_400_000 - 1;
    return milestones.filter(m => {
      const s = new Date(m.startAt).getTime();
      const e = m.endAt ? new Date(m.endAt).getTime() : s;
      return s <= dayEnd && e >= dayStart;
    });
  }, [milestones, viewDate]);

  const allDayEvents = useMemo(() => dayEvents.filter(m => m.allDay), [dayEvents]);
  const timedEvents = useMemo(() => dayEvents.filter(m => !m.allDay), [dayEvents]);

  const [nowMinutes, setNowMinutes] = useState<number>(() => today.getHours() * 60 + today.getMinutes());
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isToday) return;
    const tick = () => {
      const n = new Date();
      const mins = n.getHours() * 60 + n.getMinutes();
      setNowMinutes(prev => prev === mins ? prev : mins);
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  // Only scroll to current time on mount or when switching to today — not on every tick
  useEffect(() => {
    if (!isToday || !gridRef.current) return;
    const nowTop = Math.max(0, (nowMinutes / 60 - GRID_START) * ROW_H - 80);
    gridRef.current.scrollTop = nowTop;
  }, [isToday]);

  const nowTop = ((nowMinutes / 60) - GRID_START) * ROW_H;
  const showNow = isToday && nowMinutes / 60 >= GRID_START && nowMinutes / 60 <= GRID_END;

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const wasDraggingRef = useRef(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cleanupDragRef.current?.(); }, []);

  const startDrag = useCallback((e: React.PointerEvent, m: CalendarEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const origStartAt = new Date(m.startAt);
    const origEndAt = m.endAt ? new Date(m.endAt) : null;
    const state: DragState = { id: m.id, startY: e.clientY, deltaMinutes: 0, origStartAt, origEndAt };
    dragRef.current = state;
    setDrag(state);

    const onMove = (ev: PointerEvent) => {
      const snapped = Math.round(((ev.clientY - state.startY) / ROW_H) * 60 / SNAP_MIN) * SNAP_MIN;
      const next = { ...state, deltaMinutes: snapped };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      cleanupDragRef.current = null;
      const snapped = Math.round(((ev.clientY - state.startY) / ROW_H) * 60 / SNAP_MIN) * SNAP_MIN;
      if (snapped === 0) { setDrag(null); dragRef.current = null; return; }
      wasDraggingRef.current = true;
      const newStart = new Date(state.origStartAt.getTime() + snapped * 60_000);
      const newEnd = state.origEndAt ? new Date(state.origEndAt.getTime() + snapped * 60_000) : null;
      onEventUpdate(m.id, { startAt: newStart.toISOString(), endAt: newEnd ? newEnd.toISOString() : null });
      setDrag(null);
      dragRef.current = null;
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    cleanupDragRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onEventUpdate]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addDays(viewDate, -1))}><ChevronLeft size={14} /></Button>
        <span className={cn('text-sm font-medium flex-1 text-center capitalize', isToday && 'text-blue-600 dark:text-blue-400')}>
          {dayLabel(viewDate)}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addDays(viewDate, 1))}><ChevronRight size={14} /></Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onViewDateChange(new Date())}>Oggi</Button>
      </div>

      {allDayEvents.length > 0 && (
        <div className="border-b px-3 py-2 flex flex-wrap gap-1.5 bg-muted/10">
          <span className="text-xs text-muted-foreground self-center mr-1 shrink-0">Tutto il giorno</span>
          {allDayEvents.map(m => {
            const color = resolveBrandColor(m.brandId, brandColorMap);
            const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
            const hasNote = !!(m.notes?.[0]?.body);
            return (
              <div key={m.id} className={cn('flex items-center gap-1 group/all', isOtherBrand && 'opacity-40')}>
                <button
                  type="button"
                  onClick={() => onEventClick(m.id)}
                  className={cn('text-xs text-white rounded px-2 py-0.5 hover:brightness-110 transition-all', STATUS_OPACITY[m.status] ?? 'opacity-100')}
                  style={{ background: color }}
                >
                  {m.title}
                </button>
                {onNoteClick && (
                  <button
                    type="button"
                    onClick={() => onNoteClick(m.id)}
                    className={cn('p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors', !hasNote && 'opacity-0 group-hover/all:opacity-40')}
                    title="Note personali"
                  >
                    <StickyNote size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div ref={gridRef} className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <div className="relative select-none" style={{ height: HOURS.length * ROW_H }}>
          {HOURS.map(h => (
            <div
              key={h}
              className="absolute flex border-t border-border/20"
              style={{ top: (h - GRID_START) * ROW_H, left: 0, right: 0, height: ROW_H }}
            >
              <div className="shrink-0 flex items-start justify-end pt-1 pr-2 text-[11px] text-muted-foreground/50 tabular-nums select-none" style={{ width: LABEL_W }}>
                {String(h).padStart(2, '0')}:00
              </div>
              {canUpdate && onDayClick && (
                <div
                  className="flex-1 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => {
                    if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
                    const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), h, 0, 0);
                    onDayClick(d.toISOString());
                  }}
                />
              )}
            </div>
          ))}

          {showNow && (
            <div className="absolute pointer-events-none z-20 flex items-center" style={{ top: nowTop, left: 0, right: 0 }}>
              <div className="text-[11px] text-blue-500 tabular-nums font-medium select-none" style={{ width: LABEL_W, textAlign: 'right', paddingRight: 8 }}>
                {String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:{String(nowMinutes % 60).padStart(2, '0')}
              </div>
              <div className="flex-1 h-px bg-blue-400" />
              <div className="w-2 h-2 rounded-full bg-blue-500 -ml-1" />
            </div>
          )}

          {timedEvents.map(m => {
            const isDragging = drag?.id === m.id;
            const deltaMin = isDragging ? drag.deltaMinutes : 0;
            const start = new Date(m.startAt);
            const end = m.endAt ? new Date(m.endAt) : new Date(start.getTime() + 3_600_000);
            const startH = start.getHours() + start.getMinutes() / 60 + deltaMin / 60;
            const endH = end.getHours() + end.getMinutes() / 60 + deltaMin / 60;
            const clampedStart = Math.max(startH, GRID_START);
            const clampedEnd = Math.min(endH, GRID_END);
            const top = (clampedStart - GRID_START) * ROW_H;
            const height = Math.max(ROW_H * 0.5, (clampedEnd - clampedStart) * ROW_H);
            const color = resolveBrandColor(m.brandId, brandColorMap);
            const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
            const hasNote = !!(m.notes?.[0]?.body);
            const canDrag = canEditMilestone(m, canUpdate, activeBrandId);
            const previewStart = isDragging ? new Date(start.getTime() + deltaMin * 60_000) : start;
            const previewEnd = isDragging ? new Date(end.getTime() + deltaMin * 60_000) : end;
            return (
              <div
                key={m.id}
                className={cn('absolute rounded-r group/timed z-10', isOtherBrand && 'opacity-40', STATUS_OPACITY[m.status] ?? 'opacity-100', isDragging && 'z-30 shadow-lg')}
                style={{ top, left: LABEL_W + 4, right: 8, height, borderLeft: `3px solid ${color}`, background: isDragging ? `${color}44` : `${color}22`, cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
                onPointerDown={canDrag ? (e) => startDrag(e, m) : undefined}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
                    onEventClick(m.id);
                  }}
                  className="w-full h-full flex flex-col items-start px-2 py-1 text-left rounded-r overflow-hidden"
                  style={{ pointerEvents: isDragging ? 'none' : undefined }}
                >
                  <span className="text-xs font-medium truncate w-full" style={{ color }}>{m.title}</span>
                  {height >= ROW_H * 0.8 && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {timeLabel(previewStart)}{m.endAt ? ` – ${timeLabel(previewEnd)}` : ''}
                    </span>
                  )}
                </button>
                {onNoteClick && !isDragging && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNoteClick(m.id); }}
                    className={cn('absolute right-1 top-1 p-0.5 rounded transition-colors', hasNote ? 'text-muted-foreground' : 'opacity-0 group-hover/timed:opacity-40 text-muted-foreground')}
                    title="Note personali"
                  >
                    <StickyNote size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
