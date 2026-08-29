'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { BackupImportFieldsSchema, buildBackupImportUrl } from '@luke/core';

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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';

/**
 * Reuses the multipart field rules the upload route validates server-side, and adds the file
 * itself — the drop zone hands over a File, so it is carried in form state like any other field
 * and gets the same "tell the user what is missing" treatment. The `instanceof` check is deferred
 * into the predicate so the schema can be built during SSR, where `File` may not exist.
 */
const BackupImportFormSchema = BackupImportFieldsSchema
  .extend({ label: z.string().max(255) })
  .extend({
    file: z.custom<File>(
      value => typeof globalThis.File !== 'undefined' && value instanceof globalThis.File,
      { message: 'Seleziona un pacchetto .lukebak' }
    ),
  });

type BackupImportFormData = z.infer<typeof BackupImportFormSchema>;

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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const form = useForm<BackupImportFormData>({
    resolver: zodResolver(BackupImportFormSchema),
    // `file` has no empty value to seed — it stays undefined until the drop zone provides one, and
    // the resolver is what reports its absence.
    defaultValues: { passphrase: '', label: '' },
  });

  const file = form.watch('file');

  // The dialog stays mounted across open/close, so without this reset it reopens still holding the
  // file and passphrase of the previous import.
  useEffect(() => {
    if (open) {
      form.reset({ passphrase: '', label: '' });
      setUploadProgress(0);
    }
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-upload, taking the progress bar with it while
  // the transfer keeps running.
  const handleOpenChange = (next: boolean) => {
    if (!next && isUploading) return;
    onOpenChange(next);
  };

  const handleImport = (data: BackupImportFormData) => {
    const formData = new globalThis.FormData();
    formData.append('file', data.file);
    formData.append('passphrase', data.passphrase);
    if (data.label.trim()) formData.append('label', data.label.trim());

    const xhr = new globalThis.XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      setIsUploading(false);
      if (xhr.status === 200) {
        toast.success('Backup importato — ora disponibile per il ripristino');
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

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleImport)} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="file"
                render={() => (
                  <FormItem>
                    <FormControl>
                      <FileDropZone
                        onFile={selected => form.setValue('file', selected, { shouldValidate: true })}
                        disabled={isUploading}
                      >
                        <div className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground hover:bg-accent/50">
                          <Upload className="h-6 w-6" />
                          {file ? file.name : 'Trascina qui il file .lukebak, o clicca per selezionarlo'}
                        </div>
                      </FileDropZone>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="passphrase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passphrase</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="off" disabled={isUploading} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Etichetta (opzionale)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="es. importato da server precedente"
                        maxLength={255}
                        disabled={isUploading}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isUploading && <Progress value={uploadProgress} />}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isUploading}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isUploading}>
                {isUploading ? `Caricamento… ${uploadProgress}%` : 'Importa'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
