/**
 * Hook centralizzato per la gestione delle query e mutations delle configurazioni
 *
 * Questo hook incapsula tutta la logica tRPC per le configurazioni, fornendo:
 * - Query paginata con filtri e ordinamento
 * - Mutations per CRUD operations (create, update, delete)
 * - Mutations per import/export batch
 * - Invalidazione automatica della cache React Query
 * - Gestione errori unificata con toast notifications
 * - Stati di loading aggregati per UX migliore
 *
 * @example
 * ```tsx
 * const { data, isLoading, saveConfig, deleteConfig } = useConfigQuery({
 *   q: 'ldap',
 *   category: 'auth',
 *   page: 1,
 *   pageSize: 20
 * });
 * ```
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpc } from './trpc';

/**
 * Parametri per la query delle configurazioni
 */
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

/**
 * Dati per creare/aggiornare una configurazione
 */
export interface ConfigFormData {
  key: string;
  value: string;
  encrypt: boolean;
  category?: string;
}

/**
 * Hook personalizzato per gestire query e mutations delle configurazioni
 *
 * @param params - Parametri per la query paginata
 * @returns Oggetto con query data, mutations e helper functions
 *
 * @example
 * ```tsx
 * const { data, isLoading, setMutation, updateMutation, deleteMutation } = useConfigQuery({
 *   q: 'ldap',
 *   category: 'auth',
 *   page: 1,
 *   pageSize: 20
 * });
 * ```
 */
export function useConfigQuery(params: ConfigQueryParams = {}) {
  const queryClient = useQueryClient();

  // Query principale per lista paginata con filtri e ordinamento
  const query = (trpc as any).config.list.useQuery({
    q: params.q?.trim() || undefined,
    category: params.category,
    isEncrypted: params.isEncrypted,
    sortBy: params.sortBy || 'key',
    sortDir: params.sortDir || 'asc',
    page: params.page || 1,
    pageSize: params.pageSize || 20,
  });

  // Mutation per creare una nuova configurazione
  const setMutation = (trpc as any).config.set.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message || 'Configurazione salvata con successo');
      invalidateQueries();
    },
    onError: (error: any) => {
      console.error('Errore salvataggio configurazione:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile salvare la configurazione'}`
      );
    },
  });

  // Mutation per aggiornare una configurazione esistente
  const updateMutation = (trpc as any).config.update.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message || 'Configurazione aggiornata con successo');
      invalidateQueries();
    },
    onError: (error: any) => {
      console.error('Errore aggiornamento configurazione:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile aggiornare la configurazione'}`
      );
    },
  });

  // Mutation per eliminare una configurazione
  const deleteMutation = (trpc as any).config.delete.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message || 'Configurazione eliminata con successo');
      invalidateQueries();
    },
    onError: (error: any) => {
      console.error('Errore eliminazione configurazione:', error);

      // Gestione specifica per chiavi critiche
      if (error.code === 'CONFLICT') {
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
  const importMutation = (trpc as any).config.importJson.useMutation({
    onSuccess: (data: any) => {
      const { successCount, errorCount } = data;

      if (successCount > 0) {
        toast.success(`${successCount} configurazioni importate con successo`);
      }

      if (errorCount > 0) {
        toast.error(`${errorCount} configurazioni non sono state importate`);
      }

      invalidateQueries();
    },
    onError: (error: any) => {
      console.error('Errore import configurazioni:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile importare le configurazioni'}`
      );
    },
  });

  // Mutation per export
  const exportMutation = (trpc as any).config.exportJson.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Esportate ${data.count} configurazioni`);
    },
    onError: (error: any) => {
      console.error('Errore export configurazioni:', error);
      toast.error(
        `Errore: ${error.message || 'Impossibile esportare le configurazioni'}`
      );
    },
  });

  /**
   * Invalida tutte le query delle configurazioni per forzare il refetch
   */
  const invalidateQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['config'] });
  }, [queryClient]);

  /**
   * Helper per salvare una configurazione (create o update)
   *
   * Determina automaticamente se usare set o update basandosi sull'esistenza
   * della configurazione. Se la verifica dell'esistenza fallisce, assume
   * che sia una nuova configurazione e usa set.
   *
   * @param formData - Dati della configurazione da salvare
   * @returns Promise che si risolve con il risultato dell'operazione
   */
  const saveConfig = useCallback(
    async (formData: ConfigFormData) => {
      try {
        // Verifica se la configurazione esiste già
        const exists = await (trpc as any).config.exists.query({
          key: formData.key,
        });

        if (exists.exists) {
          return await updateMutation.mutateAsync(formData);
        } else {
          return await setMutation.mutateAsync(formData);
        }
      } catch (_error) {
        // Se la verifica fallisce, prova con set (per nuove configurazioni)
        return await setMutation.mutateAsync(formData);
      }
    },
    [setMutation, updateMutation]
  );

  /**
   * Helper per eliminare una configurazione con conferma
   */
  const deleteConfig = useCallback(
    async (key: string) => {
      return await deleteMutation.mutateAsync({ key });
    },
    [deleteMutation]
  );

  /**
   * Helper per importare configurazioni da JSON
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
   * Helper per esportare configurazioni in JSON
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
