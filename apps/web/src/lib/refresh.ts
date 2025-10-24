import { trpc } from './trpc';

/**
 * Helper centralizzato per invalidazioni consistenti delle query tRPC
 *
 * Fornisce un'interfaccia flat e self-documenting per invalidare le cache React Query
 * dopo le mutazioni, eliminando duplicazioni e garantendo coerenza.
 *
 * @example
 * ```typescript
 * const refresh = useRefresh();
 *
 * const { mutate } = useStandardMutation({
 *   mutateFn: trpc.me.updateProfile.mutateAsync,
 *   invalidate: refresh.me,
 *   onSuccessMessage: 'Profilo aggiornato',
 * });
 * ```
 */
export function useRefresh() {
  const utils = trpc.useUtils();

  return {
    // User profile
    me: () => utils.me.get.invalidate(),

    // Users list
    users: () => utils.users.list.invalidate(),

    // Storage config
    storageConfig: () => utils.storage.getConfig.invalidate(),

    // Storage files
    storageFiles: (bucket?: string) =>
      utils.storage.list.invalidate(bucket ? { bucket } : undefined),

    // LDAP integration
    ldapConfig: () => utils.integrations.auth.getLdapConfig.invalidate(),

    // Context management
    context: () => utils.context.get.invalidate(),

    // Helper compositi per invalidazioni multiple
    allStorage: () =>
      Promise.all([
        utils.storage.getConfig.invalidate(),
        utils.storage.list.invalidate(),
      ]),
  };
}
