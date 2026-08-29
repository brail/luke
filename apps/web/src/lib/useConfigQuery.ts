/**
 * Centralised hook for AppConfig query and mutation management.
 * Encapsulates all tRPC calls for the configuration admin UI, providing:
 * - Paginated list query with filtering and sorting
 * - CRUD mutations (set, update, delete)
 * - Batch import/export mutations
 * - Automatic React Query cache invalidation
 * - Unified error handling with toast notifications
 * - Aggregated loading state (`isAnyLoading`)
 */

import { useCallback } from 'react';
import { toast } from 'sonner';

import { debugError } from './debug';
import { trpc } from './trpc';

/** Parameters for the paginated config list query. */
export interface ConfigQueryParams {
  /** Ricerca per chiave (case-insensitive) */
  q?: string;
  /** Filtra per categoria dedotta dal prefisso della chiave */
  category?: string;
  /** Filtra per tipo di cifratura (true=cifrato, false=plaintext) */
  isEncrypted?: boolean;
  /** Campo per ordinamento */
  sortBy?: 'key' | 'updatedAt';
  /** Direzione ordinamento */
  sortDir?: 'asc' | 'desc';
  /** Numero pagina (1-based) */
  page?: number;
  /** Dimensione pagina (5-100) */
  pageSize?: number;
}

/** Payload for creating or updating a config entry. */
export interface ConfigFormData {
  key: string;
  value: string;
  encrypt: boolean;
  category?: string;
}

/**
 * Provides query data and mutation helpers for the AppConfig management UI.
 *
 * @param params - Filters, sorting, and pagination for the config list.
 * @returns Query state, raw mutation objects, and convenience helpers
 *   (`saveConfig`, `deleteConfig`, `importConfigs`, `exportConfigs`, `invalidateQueries`).
 */
export function useConfigQuery(params: ConfigQueryParams = {}) {
  const utils = trpc.useUtils();

  // Query principale per lista paginata con filtri e ordinamento
  const query = trpc.config.list.useQuery({
    q: params.q?.trim() || undefined,
    category: params.category,
    isEncrypted: params.isEncrypted,
    sortBy: params.sortBy || 'key',
    sortDir: params.sortDir || 'asc',
    page: params.page || 1,
    pageSize: params.pageSize || 20,
  });

  // Mutation per creare una nuova configurazione
  const setMutation = trpc.config.set.useMutation({
    onSuccess: data => {
      toast.success(data.message || 'Configurazione salvata con successo');
      invalidateQueries();
    },
    onError: error => {
      debugError('Errore salvataggio configurazione:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile salvare la configurazione'}`
      );
    },
  });

  // Mutation per aggiornare una configurazione esistente
  const updateMutation = trpc.config.update.useMutation({
    onSuccess: data => {
      toast.success(data.message || 'Configurazione aggiornata con successo');
      invalidateQueries();
    },
    onError: error => {
      debugError('Errore aggiornamento configurazione:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile aggiornare la configurazione'}`
      );
    },
  });

  // Mutation per eliminare una configurazione
  const deleteMutation = trpc.config['delete'].useMutation({
    onSuccess: data => {
      toast.success(data.message || 'Configurazione eliminata con successo');
      invalidateQueries();
    },
    onError: error => {
      debugError('Errore eliminazione configurazione:', error);

      // Gestione specifica per chiavi critiche
      if (error.data?.code === 'CONFLICT') {
        toast.error(
          'Impossibile eliminare: questa chiave è critica per il sistema'
        );
      } else {
        toast.error(
          `Errore: ${error.message || 'Impossibile eliminare la configurazione'}`
        );
      }
    },
  });

  // Mutation per import batch
  const importMutation = trpc.config.importJson.useMutation({
    onSuccess: data => {
      const { successCount, errorCount } = data;

      if (successCount > 0) {
        toast.success(`${successCount} configurazioni importate con successo`);
      }

      if (errorCount > 0) {
        toast.error(`${errorCount} configurazioni non sono state importate`);
      }

      invalidateQueries();
    },
    onError: error => {
      debugError('Errore import configurazioni:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile importare le configurazioni'}`
      );
    },
  });

  // Mutation per export
  const exportMutation = trpc.config.exportJson.useMutation({
    onSuccess: data => {
      toast.success(`Esportate ${data.count} configurazioni`);
    },
    onError: error => {
      debugError('Errore export configurazioni:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile esportare le configurazioni'}`
      );
    },
  });

  /**
   * Invalidates the `config` queries so the list refetches after a mutation.
   *
   * Goes through the tRPC utils rather than `queryClient.invalidateQueries({ queryKey: ['config'] })`:
   * a tRPC hook's key is the generated `[['config','list'], { … }]`, which a bare `['config']`
   * never matched. Nothing refetched, and it looked fine only because changing a filter builds a
   * different key and therefore fetches anyway — so a delete left the deleted row on screen.
   */
  const invalidateQueries = useCallback(() => {
    void utils.config.invalidate();
  }, [utils]);

  /**
   * Saves a config entry, picking the procedure from the caller's intent.
   *
   * `set` upserts; `update` refuses to create, which is what stops a mangled key from silently
   * becoming a new entry while the user thinks they are editing an existing one. Both take the
   * same permission, rate limit and input, so the choice is purely about that guard.
   *
   * Deliberately not "try update, fall back to set": probing with `update` made every new key
   * fail once on purpose, and the mutation's own onError surfaced that expected failure to the
   * user as an error toast and a console error before the real save went through.
   *
   * @param isNew - True when creating a key that does not exist yet.
   */
  const saveConfig = useCallback(
    async (formData: ConfigFormData, { isNew = false }: { isNew?: boolean } = {}) => {
      const mutation = isNew ? setMutation : updateMutation;
      return await mutation.mutateAsync(formData);
    },
    [setMutation, updateMutation]
  );

  /**
   * Deletes a config entry by key.
   */
  const deleteConfig = useCallback(
    async (key: string) => {
      return await deleteMutation.mutateAsync({ key });
    },
    [deleteMutation]
  );

  /**
   * Imports a batch of config entries from a JSON array.
   */
  const importConfigs = useCallback(
    async (
      items: Array<{
        key: string;
        value: string;
        encrypt?: boolean;
      }>
    ) => {
      return await importMutation.mutateAsync({ items });
    },
    [importMutation]
  );

  /**
   * Exports all config entries as a JSON blob.
   * @param includeValues - When `false`, values are omitted from the export.
   */
  const exportConfigs = useCallback(
    async (includeValues = true) => {
      return await exportMutation.mutateAsync({ includeValues });
    },
    [exportMutation]
  );

  return {
    // Query data
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,

    // Mutations
    setMutation,
    updateMutation,
    deleteMutation,
    importMutation,
    exportMutation,

    // Helper functions
    saveConfig,
    deleteConfig,
    importConfigs,
    exportConfigs,
    invalidateQueries,

    // Stati di loading aggregati
    isAnyLoading:
      query.isLoading ||
      setMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      importMutation.isPending ||
      exportMutation.isPending,
  };
}
