'use client';

import { Upload } from 'lucide-react';
import React, { useState } from 'react';

import { ConfigDeleteDialog } from '../../../../components/config/ConfigDeleteDialog';
import { ConfigEditDialog } from '../../../../components/config/ConfigEditDialog';
import { ConfigExportButton } from '../../../../components/config/ConfigExportButton';
import { ConfigImportDialog } from '../../../../components/config/ConfigImportDialog';
import { ConfigTable } from '../../../../components/config/ConfigTable';
import { ConfigTablePagination } from '../../../../components/config/ConfigTablePagination';
import { ConfigToolbar } from '../../../../components/config/ConfigToolbar';
import { ConfigValueDialog } from '../../../../components/config/ConfigValueDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { ErrorBoundary } from '../../../../components/system/ErrorBoundary';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  useConfigQuery,
  type ConfigFormData,
} from '../../../../lib/useConfigQuery';

/**
 * Pagina gestione configurazioni con CRUD completo
 *
 * Questa pagina fornisce un'interfaccia completa per la gestione delle configurazioni
 * del sistema, includendo:
 *
 * - **Ricerca e filtri**: per chiave, categoria, tipo di cifratura
 * - **Ordinamento**: per chiave o data di aggiornamento
 * - **Paginazione**: per gestire grandi quantità di configurazioni
 * - **CRUD sicuro**: create, read, update, delete con validazioni
 * - **Import/Export**: operazioni batch con anteprima e validazione
 * - **Protezioni di sicurezza**: mai mostrare segreti in chiaro, blocchi per chiavi critiche
 *
 * Utilizza il hook `useConfigQuery` per centralizzare la logica tRPC e ridurre
 * il boilerplate del componente.
 */
export default function MaintenanceConfigPage() {
  // Stati per ricerca e filtri
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEncrypted, setFilterEncrypted] = useState<boolean | undefined>();
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState<'key' | 'updatedAt'>('key');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Stati per dialog
  const [selectedConfig, setSelectedConfig] = useState<any>(null);
  const [deleteConfigKey, setDeleteConfigKey] = useState<string | null>(null);
  const [viewValue, setViewValue] = useState('');
  const [viewValueKey, setViewValueKey] = useState<string>('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Hook centralizzato per query e mutations - riduce boilerplate significativamente
  const { data, isLoading, error, saveConfig, deleteConfig, isAnyLoading } =
    useConfigQuery({
      q: searchTerm,
      isEncrypted: filterEncrypted,
      category: filterCategory,
      sortBy,
      sortDir,
      page,
      pageSize,
    });

  // Handlers
  const handleNewConfig = () => {
    setSelectedConfig(null);
    setEditDialogOpen(true);
  };

  const handleEditConfig = (config: any) => {
    setSelectedConfig(config);
    setEditDialogOpen(true);
  };

  const handleDeleteConfig = (config: any) => {
    setDeleteConfigKey(config.key);
  };

  const handleViewValue = (config: any) => {
    // Solo per valori non cifrati - sicurezza garantita dal componente Table
    setViewValue(config.valuePreview || config.value);
    setViewValueKey(config.key);
  };

  const handleSaveConfig = async (formData: ConfigFormData) => {
    await saveConfig(formData);
    setEditDialogOpen(false);
    setSelectedConfig(null);
  };

  const handleConfirmDelete = async () => {
    if (deleteConfigKey) {
      await deleteConfig(deleteConfigKey);
      setDeleteConfigKey(null);
    }
  };

  const handleSort = (field: 'key' | 'updatedAt') => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1); // Reset to first page when sorting
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleImportSuccess = () => {
    setImportDialogOpen(false);
    // L'invalidazione è gestita automaticamente dal hook
  };

  const handleOpenImport = () => {
    setImportDialogOpen(true);
  };

  // Skeleton per loading
  const SkeletonRow = () => (
    <tr>
      <td>
        <Skeleton className="h-4 w-32" />
      </td>
      <td>
        <Skeleton className="h-4 w-24" />
      </td>
      <td>
        <Skeleton className="h-4 w-16" />
      </td>
      <td>
        <Skeleton className="h-4 w-20" />
      </td>
      <td>
        <Skeleton className="h-8 w-8" />
      </td>
    </tr>
  );

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <PageHeader
          title="Configurazioni Sistema"
          description="Gestisci le configurazioni del sistema con ricerca, filtri e protezioni di sicurezza"
        />

        {/* Toolbar con ricerca e filtri */}
        <SectionCard
          title="Ricerca e Filtri"
          description="Cerca e filtra le configurazioni del sistema"
        >
          <ConfigToolbar
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            filterEncrypted={filterEncrypted}
            onFilterEncryptedChange={setFilterEncrypted}
            filterCategory={filterCategory}
            onFilterCategoryChange={setFilterCategory}
          />

          {/* Azioni in seconda riga */}
          <div className="flex gap-2 mt-4">
            <ConfigExportButton />
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenImport}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Importa
            </Button>
            <Button
              onClick={handleNewConfig}
              className="flex items-center gap-2"
            >
              Nuova Config
            </Button>
          </div>
        </SectionCard>

        {/* Tabella Configurazioni */}
        <SectionCard
          title="Configurazioni Sistema"
          description="Lista delle configurazioni con ordinamento e paginazione"
        >
          {isLoading && (
            <div className="space-y-2">
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="h-12 px-4 text-left">Chiave</th>
                      <th className="h-12 px-4 text-left">Valore</th>
                      <th className="h-12 px-4 text-left">Tipo</th>
                      <th className="h-12 px-4 text-left">Aggiornato</th>
                      <th className="h-12 px-4 text-left">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <div className="text-destructive mb-2">
                Errore nel caricamento configurazioni
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {error.message}
              </p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Riprova
              </Button>
            </div>
          )}

          {data && !isLoading && (
            <>
              <ConfigTable
                configs={data.items}
                onEdit={handleEditConfig}
                onDelete={handleDeleteConfig}
                onViewValue={handleViewValue}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />

              {data.total > pageSize && (
                <ConfigTablePagination
                  page={page}
                  pageSize={pageSize}
                  total={data.total}
                  onPageChange={handlePageChange}
                />
              )}
            </>
          )}

          {data && !isLoading && data.items.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                Nessuna configurazione trovata
              </p>
              <Button onClick={handleNewConfig}>
                Aggiungi la prima configurazione
              </Button>
            </div>
          )}
        </SectionCard>

        {/* Dialog per modifica/creazione */}
        {editDialogOpen && (
          <ConfigEditDialog
            onOpenChange={() => {
              setEditDialogOpen(false);
              setSelectedConfig(null);
            }}
            config={selectedConfig}
            onSave={handleSaveConfig}
            isLoading={isAnyLoading}
          />
        )}

        {/* Dialog per eliminazione */}
        {deleteConfigKey && (
          <ConfigDeleteDialog
            onOpenChange={() => setDeleteConfigKey(null)}
            configKey={deleteConfigKey}
            onConfirm={handleConfirmDelete}
            isLoading={isAnyLoading}
          />
        )}

        {/* Dialog per visualizzazione valore */}
        {viewValue && (
          <ConfigValueDialog
            onOpenChange={() => {
              setViewValue('');
              setViewValueKey('');
            }}
            value={viewValue}
            keyName={viewValueKey}
          />
        )}

        {/* Dialog per import */}
        {importDialogOpen && (
          <ConfigImportDialog
            onOpenChange={() => setImportDialogOpen(false)}
            onSuccess={handleImportSuccess}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
