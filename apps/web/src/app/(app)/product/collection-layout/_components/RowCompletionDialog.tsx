'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { CollectionRowSetCompletedInputSchema } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Textarea } from '../../../../../components/ui/textarea';

/** Picked from the endpoint's own input so the message under the textarea is the server's. */
const CompletionNoteSchema = CollectionRowSetCompletedInputSchema.pick({ note: true });

type CompletionNoteForm = z.infer<typeof CompletionNoteSchema>;

interface Props {
  open: boolean;
  mode: 'complete' | 'reopen';
  /** Phases the row did not go through — empty when it is already at its last planned milestone. */
  missingPhases: { value: string; label: string }[];
  onClose: () => void;
  onConfirm: (note: string) => void;
  isPending?: boolean;
}

/**
 * Reasoned confirmation for completing and reopening a row. Presentational: it returns the reason
 * to the caller and knows nothing of the mutation, like `ChangePhaseDialog`.
 *
 * The reason is mandatory in both directions — completion is the only moment the outcome is
 * fixed, and reopening cancels an outcome already recorded: without a why, the audit log would
 * only say that it happened. Same pattern as the calendar "Annulla evento" dialog.
 *
 * With a non-empty `missingPhases` the confirmation becomes a declared override: completing is not
 * forbidden (it could be bypassed by jumping to the last phase), but the user sees which phases
 * they are skipping and the server records them in the audit log.
 */
export function RowCompletionDialog({ open, mode, missingPhases, onClose, onConfirm, isPending }: Props) {
  const form = useForm<CompletionNoteForm>({
    resolver: zodResolver(CompletionNoteSchema),
    defaultValues: { note: '' },
  });

  // The dialog stays mounted across open/close, so it reopens on the previous reason unless reset.
  useEffect(() => {
    if (open) form.reset({ note: '' });
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-mutation while Cancel sits disabled.
  const handleOpenChange = (next: boolean) => {
    if (!next && !isPending) onClose();
  };

  const isForcing = mode === 'complete' && missingPhases.length > 0;
  const title = mode === 'complete' ? 'Concludi riga' : 'Riapri riga';
  const confirmLabel = isForcing ? 'Forza conclusione' : title;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => onConfirm(data.note))} className="grid gap-4">
        <div className="space-y-3 py-2">
          {isForcing ? (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                A questa riga mancano queste fasi prima di poter considerare concluso lo sviluppo:{' '}
                <strong>{missingPhases.map(p => p.label).join(', ')}</strong>. Confermi di voler
                forzare la conclusione?
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === 'complete'
                ? 'La riga esce dal countdown di fase e mostra l’esito rispetto all’ultima milestone pianificata. La motivazione è obbligatoria.'
                : 'La riga torna in lavorazione e ricomincia a essere misurata contro le scadenze di fase. La motivazione è obbligatoria.'}
            </p>
          )}

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>Motivazione *</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={mode === 'complete' ? 'Perché la riga si considera conclusa…' : 'Perché la riga viene riaperta…'}
                    className="resize-none text-sm"
                    rows={3}
                    maxLength={500}
                    disabled={isPending}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Annulla
          </Button>
          <Button type="submit" variant={isForcing ? 'destructive' : 'default'} disabled={isPending}>
            {isPending ? 'Salvataggio…' : confirmLabel}
          </Button>
        </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
