'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BackupCreateInputSchema, BackupScopeSchema } from '@luke/core';

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

export type BackupScopeChoice = z.infer<typeof BackupScopeSchema>;

/**
 * `label` is narrowed to a plain string: the core schema marks it optional, and an `undefined`
 * value would leave the Input uncontrolled on first render. It is mapped back to `undefined` on
 * submit so the payload still matches `BackupCreateInputSchema`.
 */
const BackupCreateFormSchema = BackupCreateInputSchema.extend({ label: z.string().max(255) });

type BackupCreateFormData = z.infer<typeof BackupCreateFormSchema>;

const EMPTY_BACKUP: BackupCreateFormData = { scope: 'DB', label: '' };

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
  const form = useForm<BackupCreateFormData>({
    resolver: zodResolver(BackupCreateFormSchema),
    defaultValues: EMPTY_BACKUP,
  });

  // The dialog stays mounted across open/close, so without this reset it reopens carrying the
  // scope and label of the previous run.
  useEffect(() => {
    if (open) form.reset(EMPTY_BACKUP);
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the backup is being started.
  const handleOpenChange = (next: boolean) => {
    if (!next && isLoading) return;
    onOpenChange(next);
  };

  const handleSubmit = (data: BackupCreateFormData) => {
    onConfirm({ scope: data.scope, label: data.label.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Crea backup</DialogTitle>
          <DialogDescription>
            Il backup viene cifrato (AES-256-GCM) e depositato nello storage configurato.
            Include sempre l&apos;intero registro attività (audit log).
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="scope"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contenuto</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={isLoading}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="DB">Solo database</SelectItem>
                        <SelectItem value="DB_AND_FILES">Database + file storage (loghi, foto, allegati)</SelectItem>
                      </SelectContent>
                    </Select>
                    {field.value === 'DB_AND_FILES' && (
                      <FormDescription>
                        Include tutti i file nei bucket applicativi. Più lento e più pesante di un backup solo-DB.
                      </FormDescription>
                    )}
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
                        placeholder="es. prima di migrazione X"
                        maxLength={255}
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
                {isLoading ? 'Avvio…' : 'Avvia backup'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
