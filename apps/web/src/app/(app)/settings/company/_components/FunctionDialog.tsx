'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { CompanyFunctionInputSchema } from '@luke/core';

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Input } from '../../../../../components/ui/input';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

/**
 * `description` is narrowed to a plain string: the core schema marks it optional, and an
 * `undefined` value would leave the Textarea uncontrolled on first render. It is mapped back to
 * `undefined` on submit so the payload still matches `CompanyFunctionInputSchema`.
 */
const FunctionFormSchema = CompanyFunctionInputSchema
  .pick({ slug: true, name: true, description: true })
  .extend({ description: z.string().max(500) });

type FunctionFormData = z.infer<typeof FunctionFormSchema>;

const EMPTY_FUNCTION: FunctionFormData = { slug: '', name: '', description: '' };

/** Props for {@link FunctionDialog}. */
export interface FunctionDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided the dialog opens in edit mode; omit to create a new function. */
  fn?: { id: string; slug: string; name: string; description?: string | null };
}

/**
 * Modal dialog for creating or editing a company function.
 * Operates in create mode when `fn` is omitted and edit mode when `fn` is provided.
 */
export function FunctionDialog({ open, onClose, onSaved, fn }: FunctionDialogProps) {
  const isEdit = !!fn;

  // The slug is immutable after creation, so edit mode neither renders the field nor validates it
  // (`CompanyFunctionUpdateInputSchema` omits it server-side for the same reason). Validating a
  // field nobody can see would reject the submit with an error message that has nowhere to render.
  const schema = useMemo<z.ZodType<FunctionFormData, FunctionFormData>>(
    () => (isEdit ? FunctionFormSchema.extend({ slug: z.string() }) : FunctionFormSchema),
    [isEdit]
  );

  const form = useForm<FunctionFormData>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_FUNCTION,
  });

  const createMutation = trpc.company.function.create.useMutation({
    onSuccess: () => { toast.success('Funzione creata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const updateMutation = trpc.company.function.update.useMutation({
    onSuccess: () => { toast.success('Funzione aggiornata'); onSaved(); onClose(); },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  // The dialog stays mounted across open/close and is reused for both modes: without this reset it
  // reopens showing whatever was typed last, instead of the function it was opened on.
  useEffect(() => {
    if (open) {
      form.reset(
        fn
          ? { slug: fn.slug, name: fn.name, description: fn.description ?? '' }
          : EMPTY_FUNCTION
      );
    }
  }, [open, fn, form]);

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-save while Cancel sits disabled.
  const handleOpenChange = (next: boolean) => {
    if (!next && !isPending) onClose();
  };

  const handleSubmit = (data: FunctionFormData) => {
    const description = data.description.trim() || undefined;
    if (fn) {
      updateMutation.mutate({ id: fn.id, name: data.name.trim(), description });
    } else {
      createMutation.mutate({ slug: data.slug.trim(), name: data.name.trim(), description });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica funzione' : 'Nuova funzione aziendale'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="space-y-4 py-2">
              {!isEdit && (
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Slug *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="es. product"
                          disabled={isPending}
                          {...field}
                          onChange={e => field.onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Identificatore unico, non modificabile dopo la creazione
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Nome *</FormLabel>
                    <FormControl>
                      <Input placeholder="es. Prodotto" disabled={isPending} {...field} />
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
                      <Textarea rows={2} disabled={isPending} {...field} />
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
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Salvataggio…' : 'Salva'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
