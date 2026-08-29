'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { isCriticalKey } from '../../lib/configHelpers';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';

interface ConfigDeleteDialogProps {
  onOpenChange: () => void;
  configKey: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

/**
 * Confirmation dialog for deleting an AppConfig key.
 *
 * Critical keys (from `isCriticalKey`) are blocked from deletion and render a locked badge.
 * For non-critical keys the user must type the exact key name to enable the confirm button.
 *
 * This is the one place where the primary stays disabled on incomplete input rather than
 * submitting and reporting the problem: the requirement is spelled out right above the field, so
 * the disabled button is explaining itself, and the deliberate friction is the point of a
 * type-to-confirm gate on an irreversible delete.
 *
 * @param configKey - The config key to be deleted; used for the confirmation input and critical-key check.
 */
export function ConfigDeleteDialog({
  onOpenChange,
  configKey,
  onConfirm,
  isLoading = false,
}: ConfigDeleteDialogProps) {
  const isCritical = isCriticalKey(configKey);

  const ConfirmKeySchema = useMemo(
    () =>
      z.object({
        confirmKey: z.string().refine(value => value === configKey, {
          message: 'Il nome della chiave non corrisponde',
        }),
      }),
    [configKey]
  );

  const form = useForm<z.infer<typeof ConfirmKeySchema>>({
    resolver: zodResolver(ConfirmKeySchema),
    defaultValues: { confirmKey: '' },
    // The gate has to track every keystroke: it drives whether the confirm button is enabled at
    // all, not just what happens once the form is submitted.
    mode: 'onChange',
  });

  const canDelete = !isCritical && form.formState.isValid;

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable while the delete is in flight.
  const handleOpenChange = () => {
    if (isLoading) return;
    onOpenChange();
  };

  return (
    <AlertDialog open={true} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Conferma Eliminazione
          </AlertDialogTitle>
          <AlertDialogDescription>
            Stai per eliminare la configurazione{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">
              {configKey}
            </code>
            . Questa azione è irreversibile.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(() => onConfirm())} className="grid gap-4">
            <div className="space-y-3">
              {isCritical ? (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <Lock className="w-4 h-4 text-destructive" />
                  <div>
                    <Badge variant="destructive" className="mb-1">
                      Chiave Critica — Eliminazione Bloccata
                    </Badge>
                    <p className="text-sm text-destructive">
                      Questa chiave è necessaria per il funzionamento del sistema e
                      non può essere eliminata.
                    </p>
                  </div>
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="confirmKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Digita il nome della chiave per confermare:
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={configKey} disabled={isLoading} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={isLoading}>Annulla</AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={!canDelete || isLoading}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isLoading ? 'Eliminazione...' : 'Elimina'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
