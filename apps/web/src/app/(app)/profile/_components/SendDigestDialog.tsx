'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { calendarDateIn, CalendarDigestRangeInputSchema } from '@luke/core';

import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../components/ui/form';
import { Input } from '../../../../components/ui/input';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

/**
 * Dialog letting an admin manually send the calendar digest recap for an arbitrary date range.
 *
 * The server reads the range in the caller's zone as `me.get` resolves it, so "today" is taken in
 * that same zone, never the browser's: the fields stay empty and sending stays disabled until it
 * has loaded.
 */
export function SendDigestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useForm({
    resolver: zodResolver(CalendarDigestRangeInputSchema),
    defaultValues: { from: '', to: '' },
  });
  const timezone = trpc.me.get.useQuery().data?.timezone;

  const digestMutation = trpc.system.triggerCalendarDigest.useMutation({
    onSuccess: () => {
      toast.success('Recap inviato');
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = digestMutation.isPending;

  // The dialog stays mounted across open/close, so without this reset the previous range is still
  // sitting in the fields the next time it opens.
  useEffect(() => {
    if (!open || !timezone) return;
    const today = calendarDateIn(new Date(), timezone);
    form.reset({ from: today, to: today });
  }, [open, timezone, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-send while Cancel sits disabled.
  const handleOpenChange = (next: boolean) => {
    if (!next && !isPending) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[380px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Invia Recap</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => digestMutation.mutate(data))} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 py-2">
              <FormField
                control={form.control}
                name="from"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Dal</FormLabel>
                    <FormControl>
                      <Input type="date" disabled={isPending} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="to"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Al</FormLabel>
                    <FormControl>
                      <Input type="date" disabled={isPending} {...field} />
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
              <Button type="submit" disabled={isPending || !timezone}>
                {isPending ? 'Invio...' : 'Invia'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
