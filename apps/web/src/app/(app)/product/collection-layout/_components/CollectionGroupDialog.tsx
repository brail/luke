'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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

const schema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(100),
  skuBudget: z
    .union([z.number().int().min(0), z.literal('')])
    .optional()
    .nullable(),
});
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
      skuBudget: initialSkuBudget ?? '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: initialName,
        skuBudget: initialSkuBudget ?? '',
      });
    }
  }, [open, initialName, initialSkuBudget, form]);

  const handleSubmit = form.handleSubmit(data => {
    const budget =
      data.skuBudget === '' || data.skuBudget == null
        ? null
        : Number(data.skuBudget);
    onSubmit(data.name, budget);
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
                    <Input
                      type="number"
                      min={0}
                      placeholder="Nessun limite"
                      {...field}
                      value={field.value ?? ''}
                      onChange={e =>
                        field.onChange(
                          e.target.value === '' ? '' : Number(e.target.value)
                        )
                      }
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
