import { useCallback, useState } from 'react';
import { toast } from 'sonner';

/**
 * Opzioni per mutation standardizzata
 */
type Options<TInput, TResult> = {
  /** Funzione di mutation da eseguire */
  mutateFn: (input: TInput) => Promise<TResult>;

  /** Callback per invalidare le query correlate dopo il successo */
  invalidate?: () => void | Promise<void>;

  /** Messaggio di successo da mostrare automaticamente */
  onSuccessMessage?: string;

  /** Messaggio di errore da mostrare automaticamente (opzionale se onError è fornito) */
  onErrorMessage?: string;

  /** Callback personalizzata dopo il successo (oltre al messaggio) */
  onSuccess?: (result: TResult) => void;

  /** Callback personalizzata dopo l'errore (oltre al messaggio) */
  onError?: (error: any) => void;
};

/**
 * Hook per mutation standardizzate con pattern DRY
 *
 * Elimina duplicazioni di `onSuccess`/`onError`/`toast`/`invalidate` fornendo
 * un wrapper uniforme per tutte le mutation dell'applicazione.
 *
 * @example
 * ```typescript
 * const refresh = useRefresh();
 *
 * const { mutate, isPending } = useStandardMutation({
 *   mutateFn: trpc.me.updateProfile.mutateAsync,
 *   invalidate: refresh.me,
 *   onSuccessMessage: 'Profilo aggiornato con successo',
 *   onErrorMessage: 'Errore durante l\'aggiornamento',
 * });
 *
 * // Uso
 * await mutate({ firstName: 'Mario', lastName: 'Rossi' });
 * ```
 *
 * @example Con callback personalizzate
 * ```typescript
 * const { mutate, isPending } = useStandardMutation({
 *   mutateFn: trpc.users.create.mutateAsync,
 *   invalidate: refresh.users,
 *   onSuccessMessage: 'Utente creato',
 *   onSuccess: (data) => {
 *     setDialogOpen(false);
 *     router.push(`/users/${data.id}`);
 *   },
 * });
 * ```
 */
export function useStandardMutation<TInput, TResult>(
  opts: Options<TInput, TResult>
) {
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (input: TInput) => {
      setIsPending(true);

      try {
        const res = await opts.mutateFn(input);

        // Invalidate query cache
        if (opts.invalidate) await opts.invalidate();

        // Show success toast
        if (opts.onSuccessMessage) toast.success(opts.onSuccessMessage);

        // Custom success callback
        if (opts.onSuccess) opts.onSuccess(res);

        return res;
      } catch (e: any) {
        // Show error toast with optional description
        if (opts.onErrorMessage) {
          toast.error(opts.onErrorMessage, { description: e?.message });
        }

        // Custom error callback
        if (opts.onError) opts.onError(e);

        // Re-throw per permettere gestione upstream
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [opts]
  );

  return { mutate, isPending };
}
