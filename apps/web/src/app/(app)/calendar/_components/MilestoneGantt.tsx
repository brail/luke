'use client';

import { useMemo } from 'react';

import { cn } from '../../../../lib/utils';
import { SECTION_LABELS, STATUS_OPACITY } from '../constants';
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
  onMilestoneClick: (id: string) => void;
}

const ROW_H = 36;
const LABEL_W = 200;
const DAY_W_LARGE = 24;
const DAY_W_SMALL = 13;
const HEADER_H = 40;

const MONTH_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function MilestoneGantt({ milestones, onMilestoneClick }: Props) {
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
    const totalDays = Math.max(diffDays(rangeStart, rangeEnd), 30);
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
      months.push({ label: `${MONTH_IT[month]} ${year}`, startDay: day, width: count * dayW });
      day += count;
    }

    return { rangeStart, totalDays, dayW, months };
  }, [sorted]);

  const totalW = totalDays * dayW;
  const todayOffset = diffDays(rangeStart, startOfDay(new Date()));
  const showToday = todayOffset >= 0 && todayOffset < totalDays;

  const bars = useMemo(() =>
    sorted.map(m => {
      const start = startOfDay(new Date(m.startAt));
      const end = m.endAt ? startOfDay(new Date(m.endAt)) : start;
      const left = diffDays(rangeStart, start) * dayW;
      const spanDays = Math.max(1, diffDays(start, end));
      const width = Math.max(spanDays * dayW, dayW);
      return { ...m, left, width };
    }),
    [sorted, rangeStart, dayW]
  );

  return (
    /*
     * Layout: single horizontally-scrollable container.
     * Label column is sticky-left so it stays visible while scrolling.
     * Both header and row bars live in the same scroll context.
     */
    <div className="overflow-x-auto overflow-y-visible">
      <div style={{ minWidth: LABEL_W + totalW }}>

        {/* Header row */}
        <div className="flex" style={{ height: HEADER_H }}>
          {/* Sticky label placeholder */}
          <div
            className="shrink-0 sticky left-0 z-10 bg-background border-r border-b flex items-end px-3 pb-1"
            style={{ width: LABEL_W }}
          >
            <span className="text-xs font-medium text-muted-foreground">Milestone</span>
          </div>

          {/* Month segments */}
          <div className="relative border-b flex-1" style={{ height: HEADER_H }}>
            <div style={{ width: totalW, height: HEADER_H, position: 'relative' }}>
              {months.map((seg, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-r border-border/40 px-1.5 flex items-center"
                  style={{ left: seg.startDay * dayW, width: seg.width }}
                >
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                    {seg.label}
                  </span>
                </div>
              ))}
              {showToday && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-blue-500/50"
                  style={{ left: todayOffset * dayW }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Milestone rows */}
        {bars.map((m, i) => (
          <div key={m.id} className="flex group hover:bg-muted/20 transition-colors" style={{ height: ROW_H }}>
            {/* Sticky label */}
            <button
              type="button"
              onClick={() => onMilestoneClick(m.id)}
              className={cn(
                'shrink-0 sticky left-0 z-10 bg-background group-hover:bg-muted/20',
                'border-r text-left px-3 flex items-center gap-2 min-w-0 transition-colors',
                i < bars.length - 1 && 'border-b border-border/40'
              )}
              style={{ width: LABEL_W, height: ROW_H }}
            >
              {m.brandId && (
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: brandColor(m.brandId) }}
                />
              )}
              <span className="truncate text-sm font-medium">{m.title}</span>
            </button>

            {/* Bar track */}
            <div
              className={cn('relative flex-1', i < bars.length - 1 && 'border-b border-border/40')}
              style={{ height: ROW_H }}
            >
              <div style={{ width: totalW, height: ROW_H, position: 'relative' }}>
                {/* Today marker */}
                {showToday && (
                  <div
                    className="absolute inset-y-0 w-px bg-blue-500/20"
                    style={{ left: todayOffset * dayW }}
                  />
                )}

                {/* Bar */}
                <button
                  type="button"
                  onClick={() => onMilestoneClick(m.id)}
                  title={`${m.title} — ${SECTION_LABELS[m.ownerSectionKey] ?? m.ownerSectionKey}`}
                  className={cn(
                    'absolute top-1/2 -translate-y-1/2 rounded',
                    'text-white text-xs font-medium px-1.5 overflow-hidden whitespace-nowrap',
                    'hover:brightness-110 active:brightness-95 transition-all cursor-pointer',
                    STATUS_OPACITY[m.status] ?? 'opacity-100'
                  )}
                  style={{
                    left: m.left,
                    width: m.width,
                    height: 22,
                    background: m.brandId ? brandColor(m.brandId) : 'hsl(var(--primary))',
                  }}
                >
                  {m.width > 56 && m.title}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
