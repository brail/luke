'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Ban, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { typedConfirmation } from '@luke/core';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './ui/form';
import { Input } from './ui/input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  /** Receives the typed phrase when `confirmPhrase` gates the dialog, nothing otherwise. */
  onConfirm: (confirmPhrase?: string) => void;
  isLoading?: boolean;
  userEmail?: string;
  actionType?: 'delete' | 'disable' | 'hardDelete' | 'revokeSessions' | 'warning';
  /** When set, the action unlocks only once the user types this exact phrase. */
  confirmPhrase?: string;
}

/**
 * Reusable confirmation dialog for destructive or critical actions.
 *
 * Renders an icon and button style appropriate for each `actionType`.
 * Always use this instead of `globalThis.confirm()`.
 *
 * @param actionType - Controls the icon and button color: `delete` and `hardDelete` use destructive styling; `disable` and `warning` use default styling.
 * @param userEmail - Optional email displayed below the description to identify the target user.
 * @param confirmPhrase - Gates the action behind typing this phrase; omit for a plain confirmation.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  onConfirm,
  isLoading = false,
  userEmail,
  actionType = 'delete',
  confirmPhrase,
}: ConfirmDialogProps) {
  const handleConfirm = (typed?: string) => {
    onConfirm(typed);
    onOpenChange(false);
  };

  // Esc and outside-click close through onOpenChange, a path the Cancel button does not take:
  // without this guard the dialog is dismissable mid-mutation while Cancel sits disabled, and the
  // user loses the pending state without knowing whether the action went through.
  const handleOpenChange = (next: boolean) => {
    if (!next && isLoading) return;
    onOpenChange(next);
  };

  const actionRef = useRef<HTMLButtonElement>(null);
  const phraseInputRef = useRef<HTMLInputElement>(null);

  // Reuses the server's own rule, so the dialog rejects exactly what the endpoint would and says it
  // with the same words.
  const schema = useMemo(
    () => z.object({ typed: typedConfirmation(confirmPhrase ?? '') }),
    [confirmPhrase]
  );

  const form = useForm<{ typed: string }>({
    resolver: zodResolver(schema),
    defaultValues: { typed: '' },
    // The typed phrase decides whether the action is clickable at all, so validity has to track
    // every keystroke rather than settle at submit time.
    mode: 'onChange',
  });

  useEffect(() => {
    if (open) form.reset({ typed: '' });
  }, [open, form]);

  // Radix moves focus to Cancel when an AlertDialog opens, so a reflex Enter — the same key the
  // user just pressed to submit whatever opened this — cannot fire the action. Worth keeping on an
  // irreversible delete; on a reversible confirmation it only leaves Enter doing nothing the user
  // wanted, so those focus their own action instead. The preventDefault() is what disables Radix's
  // own handler: it composes ours first and skips its Cancel focus once the event is defaulted.
  const focusesActionOnOpen = actionType === 'disable' || actionType === 'warning';

  const handleOpenAutoFocus = (event: Event) => {
    // A gated dialog puts the caret in the field instead: the action is unreachable until
    // something is typed there anyway.
    if (confirmPhrase) {
      event.preventDefault();
      phraseInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!focusesActionOnOpen) return;
    event.preventDefault();
    actionRef.current?.focus({ preventScroll: true });
  };

  // Icone per diversi tipi di azione
  const getIcon = () => {
    switch (actionType) {
      case 'delete':
        return <Trash2 className="h-5 w-5 text-destructive" />;
      case 'hardDelete':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'disable':
        // Neutral on purpose: `disable` covers the reversible deactivation of any entity — user,
        // brand, season, vendor, catalog option — not just a person.
        return <Ban className="h-5 w-5 text-orange-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
    }
  };

  // The action's colour follows from what it does, so every actionType decides its own. There is
  // no `variant` prop: it used to exist, but the switch below answered for every case except
  // `revokeSessions`, so thirty call sites passed a value that was read nowhere.
  const getActionVariant = () => {
    switch (actionType) {
      case 'delete':
      case 'hardDelete':
        return 'destructive';
      case 'disable':
      case 'warning':
      case 'revokeSessions':
        return 'default';
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]" onOpenAutoFocus={handleOpenAutoFocus}> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            {getIcon()}
            <AlertDialogTitle className="text-left">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left">
            {description}
            {userEmail && (
              <span className="block mt-2 font-medium text-foreground">
                Utente: {userEmail}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmPhrase ? (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(data => handleConfirm(data.typed))}
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="typed"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>
                      Digita <span className="font-mono font-semibold">{confirmPhrase}</span> per confermare
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={confirmPhrase}
                        autoComplete="off"
                        className="font-mono"
                        disabled={isLoading}
                        {...field}
                        ref={phraseInputRef}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={isLoading}>
                  {cancelText}
                </AlertDialogCancel>
                {/* Deliberately not AlertDialogAction: that renders a Radix DialogClose, which
                    tears the dialog down on click and detaches the form before the browser runs
                    the submit — the action would never fire. See lessons.md. */}
                <Button
                  type="submit"
                  variant={getActionVariant()}
                  disabled={isLoading || !form.formState.isValid}
                >
                  {isLoading ? 'Elaborazione...' : confirmText}
                </Button>
              </AlertDialogFooter>
            </form>
          </Form>
        ) : (
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>
              {cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              ref={actionRef}
              onClick={() => handleConfirm()}
              disabled={isLoading}
              className={
                getActionVariant() === 'destructive'
                  ? 'bg-destructive hover:bg-destructive/90'
                  : ''
              }
            >
              {isLoading ? 'Elaborazione...' : confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
