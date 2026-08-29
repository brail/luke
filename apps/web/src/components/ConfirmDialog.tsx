'use client';

import { AlertTriangle, Ban, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  isLoading?: boolean;
  userEmail?: string;
  actionType?: 'delete' | 'disable' | 'hardDelete' | 'revokeSessions' | 'warning';
}

/**
 * Reusable confirmation dialog for destructive or critical actions.
 *
 * Renders an icon and button style appropriate for each `actionType`.
 * Always use this instead of `globalThis.confirm()`.
 *
 * @param actionType - Controls the icon and button color: `delete` and `hardDelete` use destructive styling; `disable` and `warning` use default styling.
 * @param userEmail - Optional email displayed below the description to identify the target user.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  onConfirm,
  isLoading = false,
  userEmail,
  actionType = 'delete',
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-mutation while Cancel sits disabled, and the
  // user loses the pending state without knowing whether the action went through.
  const handleOpenChange = (next: boolean) => {
    if (!next && isLoading) return;
    onOpenChange(next);
  };

  const actionRef = useRef<HTMLButtonElement>(null);

  // Radix moves focus to Cancel when an AlertDialog opens, so a reflex Enter — the same key the
  // user just pressed to submit whatever opened this — cannot fire the action. Worth keeping on an
  // irreversible delete; on a reversible confirmation it only leaves Enter doing nothing the user
  // wanted, so those focus their own action instead. The preventDefault() is what disables Radix's
  // own handler: it composes ours first and skips its Cancel focus once the event is defaulted.
  const focusesActionOnOpen = actionType === 'disable' || actionType === 'warning';

  const handleOpenAutoFocus = (event: Event) => {
    if (!focusesActionOnOpen) return;
    event.preventDefault();
    actionRef.current?.focus({ preventScroll: true });
  };

  // Icone per diversi tipi di azione
  const getIcon = () => {
    switch (actionType) {
      case 'delete':
        return <Trash2 className="h-5 w-5 text-destructive" />;
      case 'hardDelete':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'disable':
        // Neutral on purpose: `disable` covers the reversible deactivation of any entity — user,
        // brand, season, vendor, catalog option — not just a person.
        return <Ban className="h-5 w-5 text-orange-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
    }
  };

  // The action's colour follows from what it does, so every actionType decides its own. There is
  // no `variant` prop: it used to exist, but the switch below answered for every case except
  // `revokeSessions`, so thirty call sites passed a value that was read nowhere.
  const getActionVariant = () => {
    switch (actionType) {
      case 'delete':
      case 'hardDelete':
        return 'destructive';
      case 'disable':
      case 'warning':
      case 'revokeSessions':
        return 'default';
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]" onOpenAutoFocus={handleOpenAutoFocus}> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            {getIcon()}
            <AlertDialogTitle className="text-left">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left">
            {description}
            {userEmail && (
              <span className="block mt-2 font-medium text-foreground">
                Utente: {userEmail}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            ref={actionRef}
            onClick={handleConfirm}
            disabled={isLoading}
            className={
              getActionVariant() === 'destructive'
                ? 'bg-destructive hover:bg-destructive/90'
                : ''
            }
          >
            {isLoading ? 'Elaborazione...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
