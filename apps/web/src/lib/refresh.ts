import { trpc } from './trpc';

/**
 * Returns a flat map of named invalidation helpers for React Query caches.
 * Use these as the `invalidate` option in `useStandardMutation` to ensure
 * consistent and de-duplicated cache invalidation after mutations.
 *
 * @returns Object with invalidation functions keyed by domain
 *   (`me`, `users`, `storageConfig`, `company`).
 *
 * @example
 * ```typescript
 * const refresh = useRefresh();
 * const { mutate } = useStandardMutation({
 *   mutateFn: trpc.me.updateProfile.mutateAsync,
 *   invalidate: refresh.me,
 * });
 * ```
 */
export function useRefresh() {
  const utils = trpc.useUtils();

  return {
    // User profile
    me: () => utils.me.get.invalidate(),

    // Users list (attivi e pending)
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
