'use client';

import { useDraggable } from '@dnd-kit/core';
import { StickyNote } from 'lucide-react';
import { type MouseEvent } from 'react';

import { cn } from '../../../../lib/utils';
import { cancelledClass } from '../constants';

interface Props {
  id: string;
  title: string;
  /** Full tooltip text (title, plus any group/duration context) — built by the caller via
   * `groupTooltip()` so this component doesn't need to know about spans or group names. */
  tooltip: string;
  cancelled: boolean;
  color: string;
  isDragging: boolean;
  hasNote?: boolean;
  /** Fixed-width group-initials badge (e.g. "U", "BR") — rendered outside the truncated title so it
   * never crowds it out regardless of the full group name's length. */
  groupInitials?: string;
  onClick: (e: MouseEvent) => void;
  onNoteClick?: (e: MouseEvent) => void;
}

/**
 * Draggable event chip used in week and month calendar views.
 *
 * Integrates with dnd-kit via `useDraggable`. A sticky-note icon appears when
 * `hasNote` is true or on hover.
 *
 * @param isDragging - Hides the chip's original slot while dragging is in progress.
 * @param onNoteClick - When provided, renders the sticky-note button.
 */
export function DraggableEventChip({ id, title, tooltip, cancelled, color, isDragging, hasNote, groupInitials, onClick, onNoteClick }: Props) {
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
          'w-full flex items-center text-left rounded px-1.5 py-0.5 text-xs text-white',
          'hover:brightness-110 transition-all cursor-grab active:cursor-grabbing',
          onNoteClick && 'pr-5',
          cancelledClass(cancelled),
          isDragging && 'opacity-30',
        )}
        style={{ background: bg }}
        title={tooltip}
      >
        {groupInitials && <span className="opacity-80 mr-1 shrink-0">{groupInitials}</span>}
        <span className="truncate min-w-0">{title}</span>
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
