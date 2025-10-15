/**
 * Dialog di conferma per l'eliminazione di una configurazione
 * Include protezione per chiavi critiche e input di conferma
 */

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { AlertTriangle, Lock } from 'lucide-react';
import { isCriticalKey } from '../../lib/config-helpers';

interface ConfigDeleteDialogProps {
  onOpenChange: () => void;
  configKey: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function ConfigDeleteDialog({
  onOpenChange,
  configKey,
  onConfirm,
  isLoading = false,
}: ConfigDeleteDialogProps) {
  const [confirmKey, setConfirmKey] = useState('');
  const isCritical = isCriticalKey(configKey);
  const canDelete = !isCritical && confirmKey === configKey;

  const handleConfirm = () => {
    if (canDelete) {
      onConfirm();
      setConfirmKey('');
    }
  };

  const handleOpenChange = () => {
    setConfirmKey('');
    onOpenChange();
  };

  return (
    <AlertDialog open={true} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Conferma Eliminazione
          </AlertDialogTitle>
          <AlertDialogDescription>
            Stai per eliminare la configurazione{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">
              {configKey}
            </code>
            . Questa azione è irreversibile.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          {isCritical ? (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <Lock className="w-4 h-4 text-destructive" />
              <div>
                <Badge variant="destructive" className="mb-1">
                  Chiave Critica — Eliminazione Bloccata
                </Badge>
                <p className="text-sm text-destructive">
                  Questa chiave è necessaria per il funzionamento del sistema e
                  non può essere eliminata.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="confirm-key" className="text-sm font-medium">
                Digita il nome della chiave per confermare:
              </Label>
              <Input
                id="confirm-key"
                value={confirmKey}
                onChange={e => setConfirmKey(e.target.value)}
                placeholder={configKey}
                disabled={isLoading}
              />
              {confirmKey && confirmKey !== configKey && (
                <p className="text-sm text-destructive">
                  Il nome della chiave non corrisponde
                </p>
              )}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canDelete || isLoading}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isLoading ? 'Eliminazione...' : 'Elimina'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
