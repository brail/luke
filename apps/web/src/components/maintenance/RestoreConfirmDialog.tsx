'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BACKUP_RESTORE_CONFIRM_PHRASE, type BackupRecord } from '@luke/core';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';

interface RestoreConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backup: BackupRecord | null;
  onConfirm: (params: { preserveAuditLog: boolean; restoreFiles: boolean }) => void;
  isLoading?: boolean;
}

/**
 * Destructive-action confirmation for restoring the database from a backup.
 *
 * Deliberately heavier than the standard `ConfirmDialog`: shows what will be overwritten,
 * explains the audit-log choice, and requires typing a literal confirmation phrase (also
 * re-validated server-side — this is friction, not the actual security boundary).
 */
export function RestoreConfirmDialog({
  open,
  onOpenChange,
  backup,
  onConfirm,
  isLoading = false,
}: RestoreConfirmDialogProps) {
  const [preserveAuditLog, setPreserveAuditLog] = useState(true);
  const [restoreFiles, setRestoreFiles] = useState(backup?.scope === 'DB_AND_FILES');
  const [typedPhrase, setTypedPhrase] = useState('');

  // Reset per-target state when a different backup is targeted — this dialog may stay mounted
  // across restore targets rather than remounting, so state must not leak between them.
  useEffect(() => {
    setPreserveAuditLog(true);
    setRestoreFiles(backup?.scope === 'DB_AND_FILES');
    setTypedPhrase('');
  }, [backup?.id, backup?.scope]);

  const canConfirm = typedPhrase === BACKUP_RESTORE_CONFIRM_PHRASE && !isLoading;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({ preserveAuditLog, restoreFiles });
  };

  if (!backup) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
            <DialogTitle className="text-left">Ripristina database da backup</DialogTitle>
          </div>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p className="font-medium text-foreground">
              Questa operazione SOVRASCRIVE completamente il database attuale con il contenuto
              del backup del{' '}
              {new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short' }).format(
                new Date(backup.createdAt)
              )}
              . Tutti i dati creati o modificati dopo quel momento andranno persi.
            </p>
            <p>
              Prima di procedere viene creato automaticamente uno snapshot di sicurezza del
              database attuale — se il restore fosse un errore, potrai ripristinare quello
              snapshot. L&apos;operazione è comunque da considerarsi irreversibile: l&apos;app
              entra in modalità manutenzione (bloccando tutti gli utenti non-admin) per la
              durata del ripristino.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="preserve-audit-log">Preserva il registro attività corrente</Label>
              <p className="text-sm text-muted-foreground">
                Se attivo (consigliato), l&apos;audit log attuale resta intatto e l&apos;evento di
                restore vi viene comunque registrato. Se disattivi, anche il registro attività
                torna a quello del backup.
              </p>
            </div>
            <Switch
              id="preserve-audit-log"
              checked={preserveAuditLog}
              onCheckedChange={setPreserveAuditLog}
            />
          </div>

          {backup.scope === 'DB_AND_FILES' && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="restore-files">Ripristina anche i file (loghi, foto, allegati)</Label>
                <p className="text-sm text-muted-foreground">
                  Questo backup include anche i file storage. Sovrascriverà i file attuali con
                  quelli salvati nel backup.
                </p>
              </div>
              <Switch id="restore-files" checked={restoreFiles} onCheckedChange={setRestoreFiles} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="confirm-phrase">
              Digita <span className="font-mono font-semibold">{BACKUP_RESTORE_CONFIRM_PHRASE}</span> per confermare
            </Label>
            <Input
              id="confirm-phrase"
              value={typedPhrase}
              onChange={e => setTypedPhrase(e.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm}>
            {isLoading ? 'Ripristino in corso…' : 'Conferma ripristino'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
