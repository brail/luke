'use client';

import { Upload } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH, buildBackupImportUrl } from '@luke/core';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { FileDropZone } from '../ui/file-drop-zone';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';

interface BackupImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful import so the caller can invalidate the backup list. */
  onImported: () => void;
}

/**
 * Dialog for importing a passphrase-protected backup export package (`.lukebak`) — either one
 * downloaded earlier from this same instance, or from a different Luke installation entirely.
 * Uses XHR (not `fetch`) to get real upload progress for potentially multi-GB files.
 */
export function BackupImportDialog({ open, onOpenChange, onImported }: BackupImportDialogProps) {
  const { data: session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [label, setLabel] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const canConfirm = file !== null && passphrase.length >= BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH;

  const reset = () => {
    setFile(null);
    setPassphrase('');
    setLabel('');
    setUploadProgress(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isUploading) reset();
    onOpenChange(next);
  };

  const handleImport = () => {
    if (!file) return;

    const formData = new globalThis.FormData();
    formData.append('file', file);
    formData.append('passphrase', passphrase);
    if (label.trim()) formData.append('label', label.trim());

    const xhr = new globalThis.XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      setIsUploading(false);
      if (xhr.status === 200) {
        toast.success('Backup importato — ora disponibile per il ripristino');
        reset();
        onOpenChange(false);
        onImported();
      } else {
        const errorData = JSON.parse(xhr.responseText || '{}');
        toast.error(errorData.message || `Import fallito (${xhr.status})`);
      }
    });
    xhr.addEventListener('error', () => {
      setIsUploading(false);
      toast.error('Errore di rete durante l\'import');
    });

    xhr.open('POST', buildBackupImportUrl());
    if (session?.accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.accessToken}`);
    }
    setIsUploading(true);
    setUploadProgress(0);
    xhr.send(formData);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Importa backup</DialogTitle>
          <DialogDescription>
            Carica un pacchetto (<code>.lukebak</code>) esportato in precedenza — da questa
            installazione o da un&apos;altra — e la passphrase scelta al momento dell&apos;export.
            Il backup importato comparirà in elenco, pronto per il ripristino.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <FileDropZone onFile={setFile} disabled={isUploading}>
            <div className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground hover:bg-accent/50">
              <Upload className="h-6 w-6" />
              {file ? file.name : 'Trascina qui il file .lukebak, o clicca per selezionarlo'}
            </div>
          </FileDropZone>

          <div className="space-y-2">
            <Label htmlFor="import-passphrase">Passphrase</Label>
            <Input
              id="import-passphrase"
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              disabled={isUploading}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-label">Etichetta (opzionale)</Label>
            <Input
              id="import-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="es. importato da server precedente"
              maxLength={255}
              disabled={isUploading}
            />
          </div>

          {isUploading && <Progress value={uploadProgress} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isUploading}>
            Annulla
          </Button>
          <Button onClick={handleImport} disabled={!canConfirm || isUploading}>
            {isUploading ? `Caricamento… ${uploadProgress}%` : 'Importa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
