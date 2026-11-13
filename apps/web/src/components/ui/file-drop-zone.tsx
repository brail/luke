'use client';

import { type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '../../lib/utils';

import { Button } from './button';

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
  // An image upload takes a paste: a click selects the area, and the picker opens from `Sfoglia…`
  // or with Enter (#54). Any other file, as an import dialog takes, opens the picker on a click.
  const openOnClick = !accept?.length || !accept.every(type => type.startsWith('image/'));
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

  const submitFile = (file: File | null | undefined) => {
    if (file && validate(file)) onFile(file);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    submitFile(e.dataTransfer.files[0]);
  };

  const handlePaste = (e: ClipboardEvent) => {
    if (disabled) return;
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file') {
        e.preventDefault();
        submitFile(item.getAsFile());
        break;
      }
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    submitFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      className={cn(
        'transition-[box-shadow,background-color]',
        !openOnClick && !disabled && 'outline-none focus-within:ring-2 focus-within:ring-ring',
        isDragOver && 'ring-2 ring-primary ring-offset-1 bg-primary/5',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onClick={openOnClick ? openPicker : undefined}
      role={openOnClick ? 'button' : 'group'}
      aria-label={openOnClick ? undefined : "Carica un'immagine: trascina, incolla o sfoglia"}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e: KeyboardEvent) => {
        // A key on a control inside the area is that control's own.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || (openOnClick && e.key === ' ')) {
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
      {/* A disabled area (read-only, or busy uploading) offers no way to upload. */}
      {!openOnClick && !disabled && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Button type="button" variant="outline" size="sm" onClick={openPicker}>
            Sfoglia…
          </Button>
          <span>o incolla un&apos;immagine (Ctrl/⌘+V)</span>
        </div>
      )}
    </div>
  );
}
