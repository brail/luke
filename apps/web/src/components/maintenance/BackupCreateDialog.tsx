'use client';

import { useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

export type BackupScopeChoice = 'DB' | 'DB_AND_FILES';

interface BackupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (params: { scope: BackupScopeChoice; label?: string }) => void;
  isLoading?: boolean;
}

/**
 * Dialog for triggering a manual backup: choose scope (DB only vs DB + storage files) and
 * an optional label. The scope choice directly drives what `runBackupJob` includes in the archive.
 */
export function BackupCreateDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: BackupCreateDialogProps) {
  const [scope, setScope] = useState<BackupScopeChoice>('DB');
  const [label, setLabel] = useState('');

  const handleConfirm = () => {
    onConfirm({ scope, label: label.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Crea backup</DialogTitle>
          <DialogDescription>
            Il backup viene cifrato (AES-256-GCM) e depositato nello storage configurato.
            Include sempre l&apos;intero registro attività (audit log).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="backup-scope">Contenuto</Label>
            <Select value={scope} onValueChange={v => setScope(v as BackupScopeChoice)}>
              <SelectTrigger id="backup-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DB">Solo database</SelectItem>
                <SelectItem value="DB_AND_FILES">Database + file storage (loghi, foto, allegati)</SelectItem>
              </SelectContent>
            </Select>
            {scope === 'DB_AND_FILES' && (
              <p className="text-sm text-muted-foreground">
                Include tutti i file nei bucket applicativi. Più lento e più pesante di un backup solo-DB.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="backup-label">Etichetta (opzionale)</Label>
            <Input
              id="backup-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. prima di migrazione X"
              maxLength={255}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Annulla
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Avvio…' : 'Avvia backup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
