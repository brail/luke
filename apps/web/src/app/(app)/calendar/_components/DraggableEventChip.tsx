'use client';

import { useDraggable } from '@dnd-kit/core';
import { StickyNote } from 'lucide-react';
import { type MouseEvent } from 'react';

import { cn } from '../../../../lib/utils';
import { cancelledClass } from '../constants';

interface Props {
  id: string;
  title: string;
  cancelled: boolean;
  color: string;
  span: number;
  isDragging: boolean;
  hasNote?: boolean;
  onClick: (e: MouseEvent) => void;
  onNoteClick?: (e: MouseEvent) => void;
}

/**
 * Draggable event chip used in week and month calendar views.
 *
 * Integrates with dnd-kit via `useDraggable`. A sticky-note icon appears when
 * `hasNote` is true or on hover.
 *
 * @param span - Number of day columns the chip should span (used in week view CSS).
 * @param isDragging - Hides the chip's original slot while dragging is in progress.
 * @param onNoteClick - When provided, renders the sticky-note button.
 */
export function DraggableEventChip({ id, title, cancelled, color, span, isDragging, hasNote, onClick, onNoteClick }: Props) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });

  const bg = color;

  return (
    <div ref={setNodeRef} className="relative w-full group/chip">
      <button
        type="button"
        onClick={onClick}
        {...listeners}
        {...attributes}
        className={cn(
          'w-full text-left rounded px-1.5 py-0.5 text-xs text-white truncate',
          'hover:brightness-110 transition-all cursor-grab active:cursor-grabbing',
          onNoteClick && 'pr-5',
          cancelledClass(cancelled),
          isDragging && 'opacity-30',
        )}
        style={{ background: bg }}
        title={`${title}${span > 0 ? ` (${span + 1}gg)` : ''}`}
      >
        {title}
      </button>

      {onNoteClick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNoteClick(e); }}
          className={cn(
            'absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded',
            'text-white/60 hover:text-white transition-colors',
            hasNote ? 'opacity-100' : 'opacity-0 group-hover/chip:opacity-60',
          )}
          title="Note personali"
        >
          <StickyNote size={9} />
        </button>
      )}
    </div>
  );
}
