'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';

import { CreateActionButton } from '../../../../components/CreateActionButton';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useAppContext } from '../../../../contexts/AppContextProvider';
import { useInvalidateContext } from '../../../../contexts/useInvalidateContext';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { BrandDialogWithPermissions } from './_components/BrandDialogWithPermissions';
import { BrandTableWithPermissions } from './_components/BrandTableWithPermissions';

type BrandItem = RouterOutputs['brand']['list']['items'][number];

/**
 * Pagina per gestione Brand
 * CRUD completo con upload logo e integrazione context
 */
export default function BrandsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
  const { brand: currentBrand } = useAppContext();
  const { can } = usePermission();

  // Query per ottenere la lista dei brand
  const {
    data: brandsData = { items: [], nextCursor: null, hasMore: false },
    isLoading,
    error,
    refetch,
  } = trpc.brand.list.useQuery({
    search: searchTerm || undefined,
  });

  const brands = brandsData.items;

  // Hook centralizzato per invalidazione cache
  const invalidateContext = useInvalidateContext();

  const getErrorMessage = (error: any) =>
    getTrpcErrorMessage(error, { CONFLICT: 'Nome o codice brand già in uso' });

  // Mutation per creare/aggiornare brand
  const createMutation = trpc.brand.create.useMutation({
    onSuccess: () => {
      invalidateContext();
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand creato con successo');
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  const updateMutation = trpc.brand.update.useMutation({
    onSuccess: updatedBrand => {
      invalidateContext(updatedBrand.id);
      setIsDialogOpen(false);
      setEditingBrand(null);
      toast.success('Brand aggiornato con successo');

      // Se il brand corrente è stato disattivato, gestisci il context
      if (currentBrand?.id === updatedBrand.id && !updatedBrand.isActive) {
        toast.info(
          'Brand disattivato. Il contesto verrà ripristinato automaticamente.'
        );
      }
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  const removeMutation = trpc.brand.remove.useMutation({
    onSuccess: removedBrand => {
      invalidateContext(removedBrand.id);
      toast.success('Brand eliminato con successo');

      // Se il brand corrente è stato eliminato, gestisci il context
      if (currentBrand?.id === removedBrand.id) {
        toast.info(
          'Brand eliminato. Il contesto verrà ripristinato automaticamente.'
        );
      }
    },
    onError: error => {
      toast.error(getErrorMessage(error));
    },
  });

  // Handler per apertura dialog creazione
  const handleCreateBrand = () => {
    setEditingBrand(null);
    setIsDialogOpen(true);
  };

  // Handler per apertura dialog modifica
  const handleEditBrand = (brand: BrandItem) => {
    setEditingBrand(brand);
    setIsDialogOpen(true);
  };

  // Handler per eliminazione brand
  const handleDeleteBrand = async (brand: BrandItem) => {
    if (
      globalThis.confirm(
        `Sei sicuro di voler eliminare il brand "${brand.name}"?`
      )
    ) {
      await removeMutation.mutateAsync({ id: brand.id });
    }
  };

  // Handler per chiusura dialog
  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingBrand(null);
  };

  // Handler per submit form
  const handleFormSubmit = async (data: any) => {
    if (editingBrand) {
      await updateMutation.mutateAsync({
        id: editingBrand.id,
        data,
      });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Brand" description="Gestione dei marchi" />

      {/* Toolbar con ricerca e azioni */}
      <SectionCard
        title="Ricerca e Filtri"
        description="Cerca e filtra i brand del sistema"
      >
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="search">Cerca brand</Label>
            <Input
              id="search"
              placeholder="Nome o codice brand..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <CreateActionButton
            label="Nuovo Brand"
            onClick={handleCreateBrand}
            canCreate={can('brands:create')}
            resourceName="brand"
            isLoading={createMutation.isPending}
          />
        </div>
      </SectionCard>

      {/* Tabella Brand */}
      <SectionCard
        title="Brand Sistema"
        description="Lista completa dei brand configurati"
      >
        <BrandTableWithPermissions
          brands={brands}
          isLoading={isLoading}
          error={error}
          onEdit={handleEditBrand}
          onDelete={handleDeleteBrand}
          onRetry={() => refetch()}
        />
      </SectionCard>

      {/* Dialog per creazione/modifica */}
      <BrandDialogWithPermissions
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        brand={editingBrand}
        onSubmit={handleFormSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
