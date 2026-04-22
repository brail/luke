'use client';

import { type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '../../lib/utils';

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string[];
  maxSizeMB?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function FileDropZone({
  onFile,
  accept,
  maxSizeMB,
  disabled,
  className,
  children,
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // counter tracks nested drag targets — prevents flicker when cursor moves over children
  const dragCounter = useRef(0);

  const validate = useCallback(
    (file: File): boolean => {
      if (accept && !accept.includes(file.type)) {
        toast.error(`Formato non supportato. Usa: ${accept.join(', ')}`);
        return false;
      }
      if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
        toast.error(`File troppo grande. Max ${maxSizeMB}MB`);
        return false;
      }
      return true;
    },
    [accept, maxSizeMB]
  );

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file && validate(file)) onFile(file);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validate(file)) onFile(file);
    e.target.value = '';
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      className={cn(
        'transition-[box-shadow,background-color]',
        isDragOver && 'ring-2 ring-primary ring-offset-1 bg-primary/5',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={openPicker}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      aria-disabled={disabled}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept?.join(',')}
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled}
        onClick={e => e.stopPropagation()}
        tabIndex={-1}
      />
      {children}
    </div>
  );
}
