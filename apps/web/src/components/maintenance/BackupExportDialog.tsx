'use client';

import { useState } from 'react';

import { BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH } from '@luke/core';

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

interface BackupExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: { passphrase: string }) => void;
  isLoading?: boolean;
}

/**
 * Dialog for exporting a backup as a passphrase-protected, instance-portable package (`.lukebak`).
 * Unlike the plain download, this package can be re-imported on any Luke instance — the passphrase
 * is the only shared secret needed, independent of the server's master key.
 */
export function BackupExportDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: BackupExportDialogProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  const canConfirm =
    passphrase.length >= BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH && passphrase === confirmPassphrase;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPassphrase('');
      setConfirmPassphrase('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Esporta backup</DialogTitle>
          <DialogDescription>
            Genera un pacchetto (<code>.lukebak</code>) protetto dalla passphrase scelta qui sotto,
            importabile anche su un&apos;altra installazione Luke. Chi ripristina dovrà conoscere questa
            passphrase — conservala in un posto sicuro, non viene salvata da nessuna parte.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="export-passphrase">Passphrase</Label>
            <Input
              id="export-passphrase"
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder={`Almeno ${BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH} caratteri`}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="export-passphrase-confirm">Conferma passphrase</Label>
            <Input
              id="export-passphrase-confirm"
              type="password"
              value={confirmPassphrase}
              onChange={e => setConfirmPassphrase(e.target.value)}
              autoComplete="new-password"
            />
            {confirmPassphrase.length > 0 && passphrase !== confirmPassphrase && (
              <p className="text-sm text-destructive">Le passphrase non coincidono.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            Annulla
          </Button>
          <Button onClick={() => onConfirm({ passphrase })} disabled={!canConfirm || isLoading}>
            {isLoading ? 'Preparazione…' : 'Esporta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
