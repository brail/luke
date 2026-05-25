'use client';

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, useCallback, useMemo, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { DAY_LABELS_IT, STATUS_OPACITY } from '../constants';
import { addDays, brandColor, canEditMilestone, daysBetween, getIsoWeek, mondayOf, sameDay, startOfDay } from '../utils';
import { DraggableMilestoneChip } from './DraggableMilestoneChip';
import { type CalendarMilestoneItem as Milestone } from './types';

interface Props {
  milestones: Milestone[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onMilestoneClick: (id: string) => void;
  onMilestoneUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  onDayClick?: (isoDate: string) => void;
  activeBrandId?: string;
  canUpdate?: boolean;
}

function WeekDayRow({ dayIso, isToday, isWeekend, isDragging, onDayClick, children }: {
  dayIso: string;
  isToday: boolean;
  isWeekend: boolean;
  isDragging: boolean;
  onDayClick?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayIso });
  return (
    <div
      ref={setNodeRef}
      onClick={onDayClick}
      className={cn(
        'flex-1 p-1.5 flex flex-wrap gap-1 content-start min-h-[52px]',
        isWeekend && 'bg-muted/20',
        isToday && 'bg-blue-50/50 dark:bg-blue-950/20',
        isDragging && isOver && 'bg-blue-50/80 dark:bg-blue-950/30 ring-1 ring-inset ring-blue-300/50',
        onDayClick && 'cursor-pointer'
      )}
    >
      {children}
    </div>
  );
}

export function MilestoneWeekView({ milestones, viewDate, onViewDateChange, onMilestoneClick, onMilestoneUpdate, onDayClick, activeBrandId, canUpdate }: Props) {
  const weekStart = useMemo(() => mondayOf(viewDate), [viewDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = useMemo(() => new Date(), []);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const byDay = useMemo(() => {
    return days.map(day => {
      const dayStart = day.getTime();
      const dayEnd = dayStart + 86_400_000 - 1;
      return milestones.filter(m => {
        const start = new Date(m.startAt).getTime();
        const end = m.endAt ? new Date(m.endAt).getTime() : start;
        return start <= dayEnd && end >= dayStart;
      });
    });
  }, [milestones, days]);

  const weekLabel = useMemo(() => {
    const end = days[6]!;
    const wn = getIsoWeek(weekStart);
    const startFmt = weekStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const endFmt = end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    return `W${wn} · ${startFmt} – ${endFmt}`;
  }, [weekStart, days]);

  const draggingMilestone = useMemo(() => milestones.find(m => m.id === draggingId), [milestones, draggingId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(null);
    if (!event.over || !canUpdate) return;

    const milestoneId = event.active.id as string;
    const m = milestones.find(x => x.id === milestoneId);
    if (!m) return;

    const origStart = startOfDay(new Date(m.startAt));
    const targetDay = startOfDay(new Date(event.over.id as string));
    const delta = daysBetween(origStart, targetDay);
    if (delta === 0) return;

    const newStart = addDays(new Date(m.startAt), delta);
    const newEnd = m.endAt ? addDays(new Date(m.endAt), delta) : undefined;
    onMilestoneUpdate(milestoneId, {
      startAt: newStart.toISOString(),
      endAt: newEnd ? newEnd.toISOString() : null,
    });
  }, [canUpdate, milestones, onMilestoneUpdate]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addDays(weekStart, -7))}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-medium flex-1 text-center">{weekLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addDays(weekStart, 7))}>
            <ChevronRight size={14} />
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onViewDateChange(new Date())}>
            Oggi
          </Button>
        </div>

        <div className="flex-1">
          {days.map((day, i) => {
            const isToday = sameDay(day, today);
            const isWeekend = i >= 5;
            const items = byDay[i] ?? [];
            return (
              <div key={i} className={cn('flex border-b last:border-b-0', isToday && 'bg-blue-50/20 dark:bg-blue-950/10')}>
                <div className={cn(
                  'w-20 shrink-0 px-2 py-1.5 flex flex-col items-end justify-start border-r',
                  isWeekend && 'bg-muted/20',
                )}>
                  <span className="text-xs text-muted-foreground">{DAY_LABELS_IT[i]}</span>
                  <span className={cn(
                    'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full',
                    isToday && 'bg-blue-500 text-white',
                    !isToday && 'text-foreground',
                  )}>
                    {day.getDate()}
                  </span>
                </div>
                <WeekDayRow
                  dayIso={day.toISOString()}
                  isToday={isToday}
                  isWeekend={isWeekend}
                  isDragging={!!draggingId}
                  onDayClick={canUpdate ? () => onDayClick?.(day.toISOString()) : undefined}
                >
                  {items.map(m => {
                    const start = new Date(m.startAt);
                    const end = m.endAt ? new Date(m.endAt) : null;
                    const isStart = sameDay(start, day);
                    const span = end ? daysBetween(start, end) : 0;
                    const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                    return (
                      <div key={m.id} className={cn('shrink-0', isOtherBrand && 'opacity-40')}>
                        {canEditMilestone(m, canUpdate, activeBrandId) && isStart ? (
                          <DraggableMilestoneChip
                            id={m.id}
                            title={m.title}
                            status={m.status}
                            brandId={m.brandId}
                            span={span}
                            isDragging={draggingId === m.id}
                            onClick={(e) => { e.stopPropagation(); onMilestoneClick(m.id); }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onMilestoneClick(m.id); }}
                            className={cn(
                              'text-left rounded px-1.5 py-0.5 text-xs text-white truncate max-w-[200px]',
                              'hover:brightness-110 transition-all',
                              STATUS_OPACITY[m.status] ?? 'opacity-100',
                              !isStart && 'opacity-40'
                            )}
                            style={{ background: m.brandId ? brandColor(m.brandId) : 'hsl(var(--primary))' }}
                            title={`${m.title}${span > 0 ? ` (${span + 1}gg)` : ''}`}
                          >
                            {isStart ? m.title : '↳'}
                          </button>
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
        {draggingMilestone && (
          <div
            className="rounded px-1.5 py-0.5 text-xs text-white truncate shadow-lg opacity-90 cursor-grabbing"
            style={{
              background: draggingMilestone.brandId ? brandColor(draggingMilestone.brandId) : 'hsl(var(--primary))',
              minWidth: 80,
            }}
          >
            {draggingMilestone.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
