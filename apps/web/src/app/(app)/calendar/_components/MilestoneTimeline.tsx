'use client';

import { useMemo } from 'react';

import { Badge } from '../../../../components/ui/badge';
import { SECTION_LABELS, STATUS_VARIANT } from '../constants';
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

export function MilestoneTimeline({ milestones, onMilestoneClick }: Props) {
  const sorted = useMemo(
    () => [...milestones].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [milestones]
  );

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[120px_1fr_120px_120px] gap-x-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
        <span>Data</span>
        <span>Milestone</span>
        <span>Sezione</span>
        <span>Stato</span>
      </div>
      {sorted.map(m => (
        <button
          key={m.id}
          type="button"
          onClick={() => onMilestoneClick(m.id)}
          className="grid grid-cols-[120px_1fr_120px_120px] gap-x-4 w-full px-3 py-2 text-left text-sm rounded hover:bg-muted/50 transition-colors"
        >
          <span className="text-muted-foreground tabular-nums">
            {new Date(m.startAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
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
            {SECTION_LABELS[m.ownerSectionKey] ?? m.ownerSectionKey}
          </span>
          <span>
            <Badge variant={STATUS_VARIANT[m.status] ?? 'outline'} className="text-xs">
              {m.status}
            </Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
