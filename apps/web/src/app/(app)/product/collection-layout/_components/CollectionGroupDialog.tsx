'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { CollectionGroupInputSchema } from '@luke/core';

import { NumberInput } from '../../../../../components/NumberInput';
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
import { Input } from '../../../../../components/ui/input';

/**
 * The two fields the dialog collects, straight from core. `order` is left out because no client
 * sends one: `createGroup` assigns it from the sibling count.
 */
const schema = CollectionGroupInputSchema.pick({ name: true, skuBudget: true });
type FormValues = z.infer<typeof schema>;

interface CollectionGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialName?: string;
  initialSkuBudget?: number | null;
  onSubmit: (name: string, skuBudget: number | null) => void;
  isLoading?: boolean;
}

/**
 * Dialog for creating or renaming a collection group.
 *
 * @param mode - Controls the dialog title ("create" vs "edit").
 * @param initialName - Pre-filled name when editing an existing group.
 * @param initialSkuBudget - Pre-filled SKU budget when editing (belongs to the group, not rows).
 * @param onSubmit - Called with the validated name and skuBudget on save.
 */
export function CollectionGroupDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialSkuBudget = null,
  onSubmit,
  isLoading = false,
}: CollectionGroupDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initialName,
      skuBudget: initialSkuBudget,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: initialName,
        skuBudget: initialSkuBudget,
      });
    }
  }, [open, initialName, initialSkuBudget, form]);

  const handleSubmit = form.handleSubmit(data => {
    onSubmit(data.name, data.skuBudget ?? null);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Nuovo gruppo' : 'Modifica gruppo'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome gruppo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="es. Collezione Uomo, Special Edition…"
                      {...field}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="skuBudget"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU Budget</FormLabel>
                  <FormControl>
                    <NumberInput
                      min={0}
                      placeholder="Nessun limite"
                      {...field}
                      value={field.value ?? ''}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        field.onChange(isNaN(v) ? null : v);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={isLoading}>
                {mode === 'create' ? 'Crea gruppo' : 'Salva'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
