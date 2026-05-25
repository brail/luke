'use client';

import { useMemo } from 'react';

import { Badge } from '../../../../components/ui/badge';
import { cn } from '../../../../lib/utils';
import { STATUS_VARIANT } from '../constants';
import { brandColor, getIsoWeek } from '../utils';

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
  onMilestoneClick: (id: string) => void;
  activeBrandId?: string;
  functionsById: Record<string, string>;
}

const MONTH_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

export function MilestoneTimeline({ milestones, onMilestoneClick, activeBrandId, functionsById }: Props) {
  const sorted = useMemo(
    () => [...milestones].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [milestones]
  );

  // Group by year-month
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof sorted }>();
    for (const m of sorted) {
      const d = new Date(m.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map.has(key)) {
        map.set(key, { label: `${MONTH_IT[d.getMonth()]} ${d.getFullYear()}`, items: [] });
      }
      map.get(key)!.items.push(m);
    }
    return Array.from(map.values());
  }, [sorted]);

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-[32px_120px_1fr_120px_120px] gap-x-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
        <span className="text-center">W</span>
        <span>Data</span>
        <span>Milestone</span>
        <span>Funzione</span>
        <span>Stato</span>
      </div>
      {groups.map(group => (
        <div key={group.label}>
          {/* Month separator */}
          <div className="grid grid-cols-[32px_120px_1fr_120px_120px] gap-x-4 px-3 py-1.5 bg-muted/40 border-b border-t mt-1 first:mt-0">
            <div className="col-span-5 text-xs font-semibold text-muted-foreground">
              {group.label}
            </div>
          </div>
          {group.items.map(m => {
            const isOtherBrand = !!activeBrandId && !!m.brandId && m.brandId !== activeBrandId;
            const d = new Date(m.startAt);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onMilestoneClick(m.id)}
                className={cn(
                  'grid grid-cols-[32px_120px_1fr_120px_120px] gap-x-4 w-full px-3 py-2 text-left text-sm rounded hover:bg-muted/50 transition-colors',
                  isOtherBrand && 'opacity-40'
                )}
              >
                <span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono text-center self-center">
                  W{getIsoWeek(d)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                </span>
                <span className="flex items-center gap-2 min-w-0">
                  {m.brandId && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ background: brandColor(m.brandId) }}
                    />
                  )}
                  <span className="truncate font-medium">{m.title}</span>
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {functionsById[m.ownerFunctionId] ?? m.ownerFunctionId}
                </span>
                <span>
                  <Badge variant={STATUS_VARIANT[m.status] ?? 'outline'} className="text-xs">
                    {m.status}
                  </Badge>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
