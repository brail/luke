import { trpc } from './trpc';

/**
 * Returns a flat map of named invalidation helpers for React Query caches.
 * Use these as the `invalidate` option in `useStandardMutation` to ensure
 * consistent and de-duplicated cache invalidation after mutations.
 *
 * @returns Object with invalidation functions keyed by domain.
 *
 * @example
 * ```typescript
 * const refresh = useRefresh();
 * const changeEmailMutation = trpc.me.changeEmail.useMutation();
 * const { mutate } = useStandardMutation({
 *   mutateFn: changeEmailMutation.mutateAsync,
 *   invalidate: refresh.me,
 * });
 * ```
 */
export function useRefresh() {
  const utils = trpc.useUtils();

  return {
    // User profile
    me: () => utils.me.get.invalidate(),

    // Everything: the server reads some dates in the user's zone (the audit log's day filter) and
    // returns that zone with the profile, and any query may come to depend on it; a change of zone
    // is rare enough to refetch them all.
    timeZone: () => utils.invalidate(),

    // Users lists (active and pending)
    users: async () => {
      await Promise.all([
        utils.users.list.invalidate(),
        utils.users.listPending.invalidate(),
      ]);
    },

    // Storage config
    storageConfig: () => utils.storage.getConfig.invalidate(),

    // Company structure (functions, teams)
    company: async () => {
      await Promise.all([
        utils.company.function.list.invalidate(),
        utils.company.team.listByFunction.invalidate(),
        utils.company.team.getById.invalidate(),
      ]);
    },
  };
}
