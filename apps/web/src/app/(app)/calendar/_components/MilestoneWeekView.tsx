'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '../../../../components/ui/button';
import { cn } from '../../../../lib/utils';
import { brandColor } from '../utils';

interface Milestone {
  id: string;
  title: string;
  startAt: Date | string;
  endAt?: Date | string | null;
  status: string;
  type: string;
  ownerSectionKey: string;
  brandId?: string | null;
  visibilities: { sectionKey: string }[];
}

interface Props {
  milestones: Milestone[];
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  onMilestoneClick: (id: string) => void;
}

const DAY_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay(); // 0=Sun
  r.setDate(r.getDate() - ((dow + 6) % 7));
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const STATUS_OPACITY: Record<string, string> = {
  PLANNED: 'opacity-70',
  IN_PROGRESS: 'opacity-100',
  COMPLETED: 'opacity-40',
  CANCELLED: 'opacity-25 line-through',
};

export function MilestoneWeekView({ milestones, viewDate, onViewDateChange, onMilestoneClick }: Props) {
  const weekStart = useMemo(() => mondayOf(viewDate), [viewDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = useMemo(() => new Date(), []);

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
    const startFmt = weekStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const endFmt = end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startFmt} – ${endFmt}`;
  }, [weekStart, days]);

  return (
    <div className="flex flex-col">
      {/* Navigation */}
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

      {/* Grid */}
      <div className="grid grid-cols-7 divide-x flex-1">
        {days.map((day, i) => {
          const isToday = sameDay(day, today);
          const items = byDay[i] ?? [];
          return (
            <div key={i} className={cn('flex flex-col min-h-[200px]', isToday && 'bg-blue-50/50 dark:bg-blue-950/20')}>
              {/* Day header */}
              <div className={cn('px-2 py-1.5 text-center border-b', isToday && 'font-semibold')}>
                <div className="text-xs text-muted-foreground">{DAY_IT[i]}</div>
                <div className={cn(
                  'text-sm mx-auto w-7 h-7 flex items-center justify-center rounded-full',
                  isToday && 'bg-blue-500 text-white'
                )}>
                  {day.getDate()}
                </div>
              </div>

              {/* Milestones */}
              <div className="p-1 space-y-0.5 flex-1">
                {items.map(m => {
                  const start = new Date(m.startAt);
                  const end = m.endAt ? new Date(m.endAt) : null;
                  const isStart = sameDay(start, day);
                  const span = end ? daysBetween(start, end) : 0;
                  return (
                    <button
                      key={m.id}
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
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
