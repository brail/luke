'use client';

import { Upload } from 'lucide-react';
import React, { useState } from 'react';

import { ConfigDeleteDialog } from '../../../../components/config/ConfigDeleteDialog';
import { ConfigEditDialog } from '../../../../components/config/ConfigEditDialog';
import { ConfigExportButton } from '../../../../components/config/ConfigExportButton';
import { ConfigImportDialog } from '../../../../components/config/ConfigImportDialog';
import { ConfigTable, type Config } from '../../../../components/config/ConfigTable';
import { ConfigTablePagination } from '../../../../components/config/ConfigTablePagination';
import { ConfigToolbar } from '../../../../components/config/ConfigToolbar';
import { ConfigValueDialog } from '../../../../components/config/ConfigValueDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { ErrorBoundary } from '../../../../components/system/ErrorBoundary';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { usePermission } from '../../../../hooks/usePermission';
import {
  useConfigQuery,
  type ConfigFormData,
} from '../../../../lib/useConfigQuery';

/**
 * Configuration management page with full CRUD.
 *
 * This page provides a complete interface for managing the system configuration,
 * including:
 *
 * - **Search and filters**: by key, category, encryption type
 * - **Sorting**: by key or update date
 * - **Pagination**: to handle large numbers of configuration entries
 * - **Safe CRUD**: create, read, update, delete with validation
 * - **Import/Export**: batch operations with preview and validation
 * - **Security safeguards**: never show secrets in the clear, locks on critical keys
 *
 * Uses the `useConfigQuery` hook to centralize the tRPC logic and cut the component
 * boilerplate.
 */
export default function MaintenanceConfigPage() {
  const { can } = usePermission();
  const canUpdate = can('config:update');

  // State for search and filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEncrypted, setFilterEncrypted] = useState<boolean | undefined>();
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState<'key' | 'updatedAt'>('key');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // State for the dialogs
  const [selectedConfig, setSelectedConfig] = useState<Config | null>(null);
  const [deleteConfigKey, setDeleteConfigKey] = useState<string | null>(null);
  const [viewValue, setViewValue] = useState('');
  const [viewValueKey, setViewValueKey] = useState<string>('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // One hook for the queries and mutations, which cuts the boilerplate
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

  const handleEditConfig = (config: Config) => {
    setSelectedConfig(config);
    setEditDialogOpen(true);
  };

  const handleDeleteConfig = (config: Config) => {
    setDeleteConfigKey(config.key);
  };

  const handleViewValue = (config: Config) => {
    // Only for unencrypted values - safety guaranteed by the Table component
    setViewValue(config.valuePreview || config.value || '');
    setViewValueKey(config.key);
  };

  const handleSaveConfig = async (formData: ConfigFormData) => {
    // `handleNewConfig` clears the selection, `handleEditConfig` sets it.
    await saveConfig(formData, { isNew: selectedConfig === null });
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
    // Invalidation is handled automatically by the hook
  };

  const handleOpenImport = () => {
    setImportDialogOpen(true);
  };

  // Loading skeleton
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

        {/* Toolbar with search and filters */}
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

          {/* Actions on a second row */}
          <div className="flex gap-2 mt-4">
            <ConfigExportButton disabled={!canUpdate} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenImport}
              disabled={!canUpdate}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Importa
            </Button>
            <Button
              onClick={handleNewConfig}
              disabled={!canUpdate}
              className="flex items-center gap-2"
            >
              Nuova Config
            </Button>
          </div>
        </SectionCard>

        {/* Configuration table */}
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
                canUpdate={canUpdate}
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
              <Button onClick={handleNewConfig} disabled={!canUpdate}>
                Aggiungi la prima configurazione
              </Button>
            </div>
          )}
        </SectionCard>

        {/* Edit/create dialog */}
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

        {/* Delete dialog */}
        {deleteConfigKey && (
          <ConfigDeleteDialog
            onOpenChange={() => setDeleteConfigKey(null)}
            configKey={deleteConfigKey}
            onConfirm={handleConfirmDelete}
            isLoading={isAnyLoading}
          />
        )}

        {/* Value view dialog */}
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

        {/* Import dialog */}
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
