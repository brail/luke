'use client';

import { AlertTriangle, Trash2, UserX } from 'lucide-react';

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
  variant?: 'default' | 'destructive';
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
  variant = 'default',
  onConfirm,
  isLoading = false,
  userEmail,
  actionType = 'delete',
}: ConfirmDialogProps) {
  void open; // Usa il parametro open per evitare warning
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  // Icone per diversi tipi di azione
  const getIcon = () => {
    switch (actionType) {
      case 'delete':
        return <Trash2 className="h-5 w-5 text-destructive" />;
      case 'hardDelete':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'disable':
        return <UserX className="h-5 w-5 text-orange-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
    }
  };

  // Colori per diversi tipi di azione
  const getActionVariant = () => {
    switch (actionType) {
      case 'delete':
      case 'hardDelete':
        return 'destructive';
      case 'disable':
      case 'warning':
        return 'default';
      default:
        return variant;
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]">
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
