'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FeedbackSubmitInputSchema } from '@luke/core';

import { useIdempotentAction } from '../lib/idempotencyKey';
import { trpc } from '../lib/trpc';
import { getTrpcErrorMessage } from '../lib/trpcErrorMessages';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './ui/form';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';

type FeedbackFormData = z.infer<typeof FeedbackSubmitInputSchema>;

const EMPTY_FEEDBACK: FeedbackFormData = { type: 'bug', title: '', description: '' };

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled dialog for submitting bug reports and feature suggestions.
 *
 * On success it creates a GitHub issue via the `feedback.submit` tRPC mutation and
 * shows a toast with the report number.
 */
export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const form = useForm<FeedbackFormData>({
    resolver: zodResolver(FeedbackSubmitInputSchema),
    defaultValues: EMPTY_FEEDBACK,
  });

  const submit = trpc.feedback.submit.useMutation({
    onSuccess: ({ issueNumber }) => {
      toast.success(`Segnalazione #${issueNumber} creata.`);
      onOpenChange(false);
    },
    onError: (err) => {
      // A 5xx here is GitHub refusing the issue; production masks the server's text.
      toast.error(getTrpcErrorMessage(err, { INTERNAL_SERVER_ERROR: 'Errore nella creazione della segnalazione. Riprova.' }));
    },
  });

  // One key per report (#248): a retry after a lost answer replays instead of opening a second issue.
  // The dialog stays mounted, so each opening is a new action.
  const { submit: submitReport } = useIdempotentAction(submit, { open });

  const type = form.watch('type');

  // The dialog stays mounted for the lifetime of the sidebar, so without this reset a report
  // abandoned halfway is still in the fields the next time it opens.
  useEffect(() => {
    if (open) form.reset(EMPTY_FEEDBACK);
  }, [open, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the issue is being created.
  const handleOpenChange = (next: boolean) => {
    if (!next && submit.isPending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Segnalazione / Suggerimento</DialogTitle>
          <DialogDescription>
            Descrivi il problema o la funzionalità che vorresti vedere.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => submitReport(data))} className="grid gap-4">
            <div className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={submit.isPending}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bug">🐛 Bug — qualcosa non funziona</SelectItem>
                        <SelectItem value="feature">✨ Suggerimento — nuova funzionalità</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Titolo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={type === 'bug' ? 'Es. Il prezzo non si salva' : 'Es. Aggiungere export PDF'}
                        maxLength={200}
                        disabled={submit.isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Descrizione</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={type === 'bug'
                          ? 'Passi per riprodurre, comportamento atteso, cosa succede invece…'
                          : 'Descrivi la funzionalità, il caso d\'uso, perché sarebbe utile…'}
                        rows={5}
                        maxLength={4000}
                        disabled={submit.isPending}
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
                disabled={submit.isPending}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending ? 'Invio…' : 'Invia'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
