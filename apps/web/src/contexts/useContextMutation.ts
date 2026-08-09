import { trpc } from '../lib/trpc';
import { useStandardMutation } from '../lib/useStandardMutation';

import { useInvalidateContext } from './useInvalidateContext';

/** Input for the `context.set` mutation. */
interface ContextSetInput {
  brandId: string;
  seasonId: string;
}

/**
 * Returns a `setContext` function that updates the user's active brand and season.
 * Wraps `trpc.context.set` with standardised toast notifications and automatic
 * cache invalidation via `useInvalidateContext`.
 *
 * @returns `{ setContext, isPending }`
 */
export function useContextMutation() {
  const invalidateContext = useInvalidateContext();

  const contextSetMutation = trpc.context.set.useMutation();

  const { mutate, isPending } = useStandardMutation({
    mutateFn: contextSetMutation.mutateAsync,
    invalidate: invalidateContext,
    onSuccessMessage: 'Contesto aggiornato',
    onErrorMessage: "Errore durante l'aggiornamento del contesto",
  });

  return {
    /** Sets the active brand and season for the current user. */
    setContext: (input: ContextSetInput) => mutate(input),
    isPending,
  };
}
