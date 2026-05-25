'use client';

import { useDroppable } from '@dnd-kit/core';
import { ReactNode } from 'react';

import { cn } from '../../../../lib/utils';

interface Props {
  dayIso: string;
  isToday: boolean;
  isDragging: boolean;
  children: ReactNode;
}

export function DroppableDayCell({ dayIso, isToday, isDragging, children }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: dayIso });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-h-[200px]',
        isToday && 'bg-blue-50/50 dark:bg-blue-950/20',
        isDragging && isOver && 'bg-blue-50/80 dark:bg-blue-950/30 ring-1 ring-inset ring-blue-300/50'
      )}
    >
      {children}
    </div>
  );
}
