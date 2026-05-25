'use client';

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, useCallback, useMemo, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { STATUS_OPACITY } from '../constants';
import { addDays, addMonths, brandColor, daysBetween, getIsoWeek, mondayOf, sameDay, startOfDay } from '../utils';
import { DraggableMilestoneChip } from './DraggableMilestoneChip';

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

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTH_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const MAX_CHIPS = 3;

function MonthDayCell({ dayIso, isToday, isDragging, isCurrentMonth, children }: {
  dayIso: string;
  isToday: boolean;
  isDragging: boolean;
  isCurrentMonth: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayIso });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 min-w-0 min-h-[90px] p-1 flex flex-col border-r last:border-r-0',
        !isCurrentMonth && 'bg-muted/30',
        isToday && 'bg-blue-50/50 dark:bg-blue-950/20',
        isDragging && isOver && 'bg-blue-50/80 dark:bg-blue-950/30 ring-1 ring-inset ring-blue-300/50'
      )}
    >
      {children}
    </div>
  );
}

export function MilestoneMonthView({ milestones, viewDate, onViewDateChange, onMilestoneClick, onMilestoneUpdate, activeBrandId, canUpdate }: Props) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const gridStart = useMemo(() => mondayOf(new Date(year, month, 1)), [year, month]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const today = useMemo(() => new Date(), []);

  const byDay = useMemo(() => {
    return cells.map(day => {
      const dayStart = day.getTime();
      const dayEnd = dayStart + 86_400_000 - 1;
      return milestones.filter(m => {
        const start = new Date(m.startAt).getTime();
        const end = m.endAt ? new Date(m.endAt).getTime() : start;
        return start <= dayEnd && end >= dayStart;
      });
    });
  }, [milestones, cells]);

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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addMonths(viewDate, -1))}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-medium flex-1 text-center">
            {MONTH_IT[month]} {year}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewDateChange(addMonths(viewDate, 1))}>
            <ChevronRight size={14} />
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onViewDateChange(new Date())}>
            Oggi
          </Button>
        </div>

        <div className="flex border-b">
          <div className="w-7 shrink-0 border-r border-border/40" />
          {DAY_LABELS.map(d => (
            <div key={d} className="flex-1 min-w-0 px-2 py-1 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        <div className="flex-1">
          {Array.from({ length: 6 }, (_, rowIdx) => {
            const weekDays = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
            const weekNum = getIsoWeek(weekDays[0]!);
            return (
              <div key={rowIdx} className="flex border-b last:border-b-0">
                <div className="w-7 shrink-0 flex items-start justify-center pt-1.5 text-[10px] font-mono text-muted-foreground/50 border-r border-border/40 bg-muted/10">
                  {weekNum}
                </div>
                {weekDays.map((day, dayIdx) => {
                  const cellIdx = rowIdx * 7 + dayIdx;
                  const isCurrentMonth = day.getMonth() === month;
                  const isToday = sameDay(day, today);
                  const items = byDay[cellIdx] ?? [];
                  const overflow = items.length - MAX_CHIPS;
                  return (
                    <MonthDayCell
                      key={dayIdx}
                      dayIso={day.toISOString()}
                      isToday={isToday}
                      isDragging={!!draggingId}
                      isCurrentMonth={isCurrentMonth}
                    >
                      <div className="mb-0.5">
                        <span className={cn(
                          'text-xs inline-flex items-center justify-center w-5 h-5 rounded-full',
                          isToday && 'bg-blue-500 text-white font-semibold',
                          !isToday && !isCurrentMonth && 'text-muted-foreground/50',
                          !isToday && isCurrentMonth && 'text-muted-foreground'
                        )}>
                          {day.getDate()}
                        </span>
                      </div>
                      <div className="space-y-0.5 flex-1">
                        {items.slice(0, MAX_CHIPS).map(m => {
                          const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                          const start = new Date(m.startAt);
                          const end = m.endAt ? new Date(m.endAt) : null;
                          const isStart = sameDay(start, day);
                          const span = end ? daysBetween(start, end) : 0;
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
                                    'w-full text-left rounded px-1 py-0.5 text-[11px] text-white truncate leading-tight',
                                    'hover:brightness-110 transition-all',
                                    STATUS_OPACITY[m.status] ?? 'opacity-100',
                                    !isStart && 'opacity-40'
                                  )}
                                  style={{ background: m.brandId ? brandColor(m.brandId) : 'hsl(var(--primary))' }}
                                  title={m.title}
                                >
                                  {isStart ? m.title : '↳'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <div className="text-[10px] text-muted-foreground px-1">
                            +{overflow} altri
                          </div>
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
