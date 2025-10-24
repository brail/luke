import { trpc } from '../lib/trpc';
import { useStandardMutation } from '../lib/useStandardMutation';

import { useInvalidateContext } from './useInvalidateContext';

/**
 * Input per la mutation context.set
 */
interface ContextSetInput {
  brandId: string;
  seasonId: string;
}

/**
 * Hook per gestire le mutation del context
 *
 * Wrapper standardizzato per context.set con gestione errori,
 * toast e invalidazioni automatiche.
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
    /**
     * Imposta il context per l'utente
     * @param input - Brand e Season ID da impostare
     */
    setContext: (input: ContextSetInput) => mutate(input),
    isPending,
  };
}
