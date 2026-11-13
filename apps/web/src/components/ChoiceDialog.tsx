'use client';

import { useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

interface ChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Closes the dialog and does nothing else. */
  cancelText: string;
  secondaryText: string;
  onSecondary: () => void;
  primaryText: string;
  onPrimary: () => void;
  /** Focuses the primary action on open, so Enter takes it; otherwise the cancel has the focus. */
  focusPrimary?: boolean;
}

/**
 * A question with two answers besides cancelling — save, discard or stay; with or without — where
 * `ConfirmDialog` offers only one. Each answer closes the dialog before its callback runs.
 */
export function ChoiceDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelText,
  secondaryText,
  onSecondary,
  primaryText,
  onPrimary,
  focusPrimary = false,
}: ChoiceDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  // The text stays while the dialog animates closed, after the caller has dropped its subject.
  const [shown, setShown] = useState({ title, description });
  if (open && (shown.title !== title || shown.description !== description)) setShown({ title, description });
  const text = open ? { title, description } : shown;
  // Once per opening: the buttons stay clickable while the dialog animates closed, and `open` drops
  // only on the caller's next render.
  const answered = useRef(false);
  useEffect(() => {
    if (open) answered.current = false;
  }, [open]);
  const answer = (callback: () => void) => {
    if (answered.current) return;
    answered.current = true;
    onOpenChange(false);
    callback();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={e => {
          if (!focusPrimary) return;
          e.preventDefault();
          primaryRef.current?.focus({ preventScroll: true });
        }}
        // A held key that opened the dialog must not answer it: a repeated Enter or Space never
        // activates a button (a held Tab still moves the focus).
        onKeyDown={e => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={() => answer(onSecondary)}>
            {secondaryText}
          </Button>
          <Button type="button" ref={primaryRef} onClick={() => answer(onPrimary)}>
            {primaryText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
