'use client';

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { STATUS_OPACITY } from '../constants';
import { addDays, brandColor, daysBetween, getIsoWeek, mondayOf, sameDay, startOfDay } from '../utils';
import { DraggableMilestoneChip } from './DraggableMilestoneChip';
import { DroppableDayCell } from './DroppableDayCell';

interface Milestone {
  id: string;
  title: string;
  startAt: Date | string;
  endAt?: Date | string | null;
  status: string;
  type: string;
  ownerFunctionId: string;
  brandId?: string | null;
  visibilities: { functionId: string }[];
}

interface Props {
  milestones: Milestone[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onMilestoneClick: (id: string) => void;
  onMilestoneUpdate: (id: string, data: { startAt: string; endAt?: string | null }) => void;
  activeBrandId?: string;
  canUpdate?: boolean;
}

const DAY_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function MilestoneWeekView({ milestones, viewDate, onViewDateChange, onMilestoneClick, onMilestoneUpdate, activeBrandId, canUpdate }: Props) {
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

        <div className="grid grid-cols-7 divide-x flex-1">
          {days.map((day, i) => {
            const isToday = sameDay(day, today);
            const items = byDay[i] ?? [];
            return (
              <DroppableDayCell key={i} dayIso={day.toISOString()} isToday={isToday} isDragging={!!draggingId}>
                <div className={cn('px-2 py-1.5 text-center border-b', isToday && 'font-semibold')}>
                  <div className="text-xs text-muted-foreground">{DAY_IT[i]}</div>
                  <div className={cn(
                    'text-sm mx-auto w-7 h-7 flex items-center justify-center rounded-full',
                    isToday && 'bg-blue-500 text-white'
                  )}>
                    {day.getDate()}
                  </div>
                </div>

                <div className="p-1 space-y-0.5 flex-1">
                  {items.map(m => {
                    const start = new Date(m.startAt);
                    const end = m.endAt ? new Date(m.endAt) : null;
                    const isStart = sameDay(start, day);
                    const span = end ? daysBetween(start, end) : 0;
                    const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                    return (
                      <div key={m.id} className={cn(isOtherBrand && 'opacity-40')}>
                        {canUpdate && isStart ? (
                          <DraggableMilestoneChip
                            id={m.id}
                            title={m.title}
                            status={m.status}
                            brandId={m.brandId}
                            span={span}
                            isDragging={draggingId === m.id}
                            onClick={() => onMilestoneClick(m.id)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onMilestoneClick(m.id)}
                            className={cn(
                              'w-full text-left rounded px-1.5 py-0.5 text-xs text-white truncate',
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
                </div>
              </DroppableDayCell>
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
