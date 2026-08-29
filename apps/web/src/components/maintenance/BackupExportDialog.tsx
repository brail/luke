'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH, BackupExportInputSchema } from '@luke/core';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';

/**
 * Reuses the core passphrase rules (minimum length and its message) and adds the confirmation
 * field, which exists only in the UI — the server is sent a single passphrase.
 */
const BackupExportFormSchema = BackupExportInputSchema
  .pick({ passphrase: true })
  .extend({ confirmPassphrase: z.string() })
  .refine(value => value.passphrase === value.confirmPassphrase, {
    path: ['confirmPassphrase'],
    message: 'Le passphrase non coincidono.',
  });

type BackupExportFormData = z.infer<typeof BackupExportFormSchema>;

const EMPTY_EXPORT: BackupExportFormData = { passphrase: '', confirmPassphrase: '' };

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
  const form = useForm<BackupExportFormData>({
    resolver: zodResolver(BackupExportFormSchema),
    defaultValues: EMPTY_EXPORT,
  });

  // The dialog stays mounted across open/close, so without this reset a passphrase typed for an
  // earlier export is still in the fields the next time it opens.
  useEffect(() => {
    if (open) form.reset(EMPTY_EXPORT);
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the package is being prepared.
  const handleOpenChange = (next: boolean) => {
    if (!next && isLoading) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Esporta backup</DialogTitle>
          <DialogDescription>
            Genera un pacchetto (<code>.lukebak</code>) protetto dalla passphrase scelta qui sotto,
            importabile anche su un&apos;altra installazione Luke. Chi ripristina dovrà conoscere questa
            passphrase — conservala in un posto sicuro, non viene salvata da nessuna parte.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => onConfirm({ passphrase: data.passphrase }))} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="passphrase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passphrase</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={`Almeno ${BACKUP_EXPORT_PASSPHRASE_MIN_LENGTH} caratteri`}
                        autoComplete="new-password"
                        disabled={isLoading}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassphrase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conferma passphrase</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        disabled={isLoading}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Preparazione…' : 'Esporta'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
