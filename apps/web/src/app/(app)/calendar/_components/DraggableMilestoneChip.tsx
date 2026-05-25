'use client';

import { useDraggable } from '@dnd-kit/core';
import { type MouseEvent } from 'react';

import { cn } from '../../../../lib/utils';
import { STATUS_OPACITY } from '../constants';
import { brandColor } from '../utils';

interface Props {
  id: string;
  title: string;
  status: string;
  brandId?: string | null;
  span: number;
  isDragging: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function DraggableMilestoneChip({ id, title, status, brandId, span, isDragging, onClick }: Props) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...listeners}
      {...attributes}
      className={cn(
        'w-full text-left rounded px-1.5 py-0.5 text-xs text-white truncate',
        'hover:brightness-110 transition-all cursor-grab active:cursor-grabbing',
        STATUS_OPACITY[status] ?? 'opacity-100',
        isDragging && 'opacity-30',
      )}
      style={{ background: brandId ? brandColor(brandId) : 'hsl(var(--primary))' }}
      title={`${title}${span > 0 ? ` (${span + 1}gg)` : ''}`}
    >
      {title}
    </button>
  );
}
