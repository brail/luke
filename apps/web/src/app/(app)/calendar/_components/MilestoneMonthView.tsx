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
  activeBrandId?: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTH_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const MAX_CHIPS = 3;

function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - ((dow + 6) % 7));
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const STATUS_OPACITY: Record<string, string> = {
  PLANNED: 'opacity-70',
  IN_PROGRESS: 'opacity-100',
  COMPLETED: 'opacity-40',
  CANCELLED: 'opacity-25 line-through',
};

export function MilestoneMonthView({ milestones, viewDate, onViewDateChange, onMilestoneClick, activeBrandId }: Props) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // 6-week grid starting from the Monday of the first week of the month
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

  return (
    <div className="flex flex-col">
      {/* Navigation */}
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

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b">
        {DAY_LABELS.map(d => (
          <div key={d} className="px-2 py-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1 divide-x divide-y">
        {cells.map((day, i) => {
          const isCurrentMonth = day.getMonth() === month;
          const isToday = sameDay(day, today);
          const items = byDay[i] ?? [];
          const overflow = items.length - MAX_CHIPS;

          return (
            <div
              key={i}
              className={cn(
                'min-h-[90px] p-1 flex flex-col',
                !isCurrentMonth && 'bg-muted/30',
                isToday && 'bg-blue-50/50 dark:bg-blue-950/20'
              )}
            >
              {/* Date number */}
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

              {/* Milestone chips */}
              <div className="space-y-0.5 flex-1">
                {items.slice(0, MAX_CHIPS).map(m => {
                  const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
                  return (
                    <div key={m.id} className={cn(isOtherBrand && 'opacity-40')}>
                      <button
                        type="button"
                        onClick={() => onMilestoneClick(m.id)}
                        className={cn(
                          'w-full text-left rounded px-1 py-0.5 text-[11px] text-white truncate leading-tight',
                          'hover:brightness-110 transition-all',
                          STATUS_OPACITY[m.status] ?? 'opacity-100'
                        )}
                        style={{ background: m.brandId ? brandColor(m.brandId) : 'hsl(var(--primary))' }}
                        title={m.title}
                      >
                        {m.title}
                      </button>
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{overflow} altri
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
