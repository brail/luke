'use client';

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
import { AlertTriangle, Trash2, UserX } from 'lucide-react';

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
  actionType?: 'delete' | 'disable' | 'hardDelete';
}

/**
 * Dialog di conferma riutilizzabile per azioni critiche
 * Supporta diverse varianti e tipi di azione con icone appropriate
 */
// eslint-disable-next-line no-unused-vars
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
