'use client';

import { type Announcements, DndContext, type DndContextProps, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import React, { useLayoutEffect, useRef } from 'react';

const SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

// The defaults read raw event ids aloud, in English, and explain a keyboard drag these views lack.
const NO_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

/**
 * The drag context of the calendar views. dnd-kit keeps its listeners until the release and still
 * calls `onDragEnd` after an unmount, so a drop reaches the view only while it is mounted. It also
 * fires `onDragMove` from a passive effect, which can run after the drag ended: such a move is dropped.
 */
export function CalendarDndContext({ onDragStart, onDragMove, onDragEnd, onDragCancel, ...props }: DndContextProps) {
  const sensors = useSensors(useSensor(PointerSensor, SENSOR_OPTIONS));
  const mountedRef = useRef(true);
  const draggingRef = useRef(false);
  // A layout effect: its cleanup runs in the unmount commit, leaving no window for a late release.
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return (
    <DndContext
      {...props}
      sensors={sensors}
      accessibility={{ announcements: NO_ANNOUNCEMENTS, screenReaderInstructions: { draggable: '' } }}
      onDragStart={e => { draggingRef.current = true; onDragStart?.(e); }}
      onDragMove={e => { if (draggingRef.current) onDragMove?.(e); }}
      onDragEnd={e => { draggingRef.current = false; if (mountedRef.current) onDragEnd?.(e); }}
      onDragCancel={e => { draggingRef.current = false; onDragCancel?.(e); }}
    />
  );
}

/**
 * A positioned block the pointer can drag, for a view that moves it through its own preview state
 * rather than a dnd-kit transform. Listeners only: with no keyboard sensor there is no draggable
 * role to expose.
 */
export function PreviewDragSource({ dragId, disabled, ...props }: { dragId: string; disabled?: boolean } & React.ComponentProps<'div'>) {
  const { listeners, setNodeRef } = useDraggable({ id: dragId, disabled });
  return <div ref={setNodeRef} {...props} {...listeners} />;
}
