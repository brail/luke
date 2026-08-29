'use client';

import { Lock } from 'lucide-react';

import { isCriticalKey } from '../../lib/configHelpers';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';

interface ConfigDeleteDialogProps {
  onOpenChange: () => void;
  configKey: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

/**
 * Confirmation dialog for deleting an AppConfig key.
 *
 * A deletable key goes through the shared `ConfirmDialog`, typing the key name itself as the
 * confirmation — the same gate the permanent deletions use, with the entity's own identifier in
 * place of their fixed phrase.
 *
 * A critical key (from `isCriticalKey`) cannot be deleted at all, so it gets its own dialog: there
 * is no action to confirm, only a reason to read.
 *
 * @param configKey - The config key to be deleted; used both as the confirmation phrase and for the critical-key check.
 */
export function ConfigDeleteDialog({
  onOpenChange,
  configKey,
  onConfirm,
  isLoading = false,
}: ConfigDeleteDialogProps) {
  if (isCriticalKey(configKey)) {
    return (
      <AlertDialog open={true} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-destructive" />
              Eliminazione bloccata
            </AlertDialogTitle>
          </AlertDialogHeader>

          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3">
            <div>
              <Badge variant="destructive" className="mb-1">
                Chiave critica
              </Badge>
              <p className="text-sm text-destructive">
                <code className="font-mono">{configKey}</code> è necessaria per il funzionamento
                del sistema e non può essere eliminata.
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Chiudi</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <ConfirmDialog
      open={true}
      onOpenChange={open => { if (!open) onOpenChange(); }}
      title="Conferma eliminazione"
      description={`Stai per eliminare la configurazione ${configKey}. Questa azione è irreversibile.`}
      confirmText="Elimina"
      cancelText="Annulla"
      actionType="hardDelete"
      confirmPhrase={configKey}
      onConfirm={() => onConfirm()}
      isLoading={isLoading}
    />
  );
}
