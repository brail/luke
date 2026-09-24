import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { getTrpcErrorMessage } from './trpcErrorMessages';

/** Options for `useStandardMutation`. */
type Options<TInput, TResult> = {
  /** The async mutation function to execute (e.g. the `mutateAsync` of `trpc.entity.create.useMutation()`). */
  mutateFn: (input: TInput) => Promise<TResult>;

  /** Called after a successful mutation to invalidate related React Query caches. */
  invalidate?: () => void | Promise<void>;

  /** Success toast message shown automatically after the mutation resolves. */
  onSuccessMessage?: string;

  /** Error toast message shown automatically when the mutation rejects. */
  onErrorMessage?: string;

  /** Per-error-code overrides forwarded to `getTrpcErrorMessage` (see its docs for the `true` sentinel). */
  entityMessages?: Record<string, string | true>;

  /** Additional success callback invoked after the toast and cache invalidation. */
  onSuccess?: (result: TResult) => void;

  /** Additional error callback invoked after the error toast. */
  onError?: (error: unknown) => void;
};

/**
 * Standardized mutation hook implementing the DRY pattern.
 *
 * Wraps a tRPC mutation with cache invalidation and optional success/error toasts, so the
 * call site doesn't repeat the `onSuccess`/`onError`/`toast`/`invalidate` boilerplate.
 * Opt-in: most mutations in the application call `.useMutation()` directly.
 *
 * @example
 * ```typescript
 * const refresh = useRefresh();
 * const saveConfigMutation = trpc.storage.saveConfig.useMutation();
 *
 * const { mutate: saveConfig, isPending } = useStandardMutation({
 *   mutateFn: saveConfigMutation.mutateAsync,
 *   invalidate: refresh.storageConfig,
 *   onSuccessMessage: 'Storage configuration saved',
 *   onErrorMessage: 'Error while saving',
 * });
 *
 * // Usage
 * await saveConfig(values);
 * ```
 *
 * @example With custom callbacks
 * ```typescript
 * const rejectMutation = trpc.users.rejectPending.useMutation();
 *
 * const { mutate: reject } = useStandardMutation({
 *   mutateFn: rejectMutation.mutateAsync,
 *   invalidate: refresh.users,
 *   onSuccessMessage: 'User rejected',
 *   onSuccess: () => setRejectTarget(null),
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
      } catch (e: unknown) {
        // Show error toast with optional description
        if (opts.onErrorMessage) {
          toast.error(opts.onErrorMessage, { description: getTrpcErrorMessage(e, opts.entityMessages) });
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
